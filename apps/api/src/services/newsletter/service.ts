import { and, count, desc, eq, inArray, lte, newsletter, post, sql } from "@blog/db";
import { isContentEmpty } from "@blog/content";
import type {
  CreateNewsletterInput,
  LexicalContent,
  ListNewslettersQuery,
  Newsletter,
  NewsletterStats,
  NewsletterSummary,
  SendNewsletterResult,
  UpdateNewsletterInput,
} from "@blog/shared";
import type { Deps } from "../../deps";
import { HttpError, conflict, notFound } from "../../errors";
import { audit } from "../../lib/audit";
import { iso } from "../admin/common";
import { ListmonkError } from "./listmonk";
import { assertValidContent, contentFromPost, previewHtml, renderNewsletterHtml } from "./render";

type Row = typeof newsletter.$inferSelect;
type Actor = { id: string };

const EDITABLE = ["draft", "scheduled", "failed"] as const;
const SENDABLE = ["draft", "scheduled", "failed"] as const;
/** a `sending` newsletter untouched for this long was interrupted (crash / timeout) and is moved to `failed` by cron */
const STALE_SENDING_MS = 30 * 60 * 1000;

export const NOOP_WARNING = "The newsletter provider (listmonk) is not configured, so nothing was sent. Set LISTMONK_URL, LISTMONK_USER and LISTMONK_API_TOKEN.";

function toSummary(r: Row): NewsletterSummary {
  return {
    id: r.id,
    subject: r.subject,
    preheader: r.preheader,
    postId: r.postId,
    status: r.status,
    listmonkCampaignId: r.listmonkCampaignId,
    scheduledFor: iso(r.scheduledFor),
    sentAt: iso(r.sentAt),
    stats: (r.stats as NewsletterStats | null) ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toNewsletter(r: Row): Newsletter {
  return { ...toSummary(r), content: (r.content as LexicalContent | null) ?? null, html: r.html };
}

const maskEmail = (e: string): string => e.replace(/^(.).*(@.*)$/, "$1***$2");

const noContent = () => new HttpError(422, "validation_error", "The newsletter has no content yet", { details: [{ path: ["content"], message: "Content is empty" }] });

export interface DueResult {
  sent: number;
  failed: number;
  interrupted: number;
  skipped?: string;
}

export function createNewsletterService(deps: Deps) {
  const { db } = deps;
  const provider = () => deps.newsletter;
  const isNoop = () => (provider().kind ?? "noop") === "noop";

  async function find(id: string): Promise<Row> {
    const [row] = await db.select().from(newsletter).where(eq(newsletter.id, id)).limit(1);
    if (!row) throw notFound("Newsletter not found");
    return row;
  }

  const render = (r: { subject: string; preheader: string | null; content: unknown }): string =>
    r.content ? renderNewsletterHtml(deps.config, { subject: r.subject, preheader: r.preheader, content: r.content }) : "";

  const campaignName = (r: Row) => `${r.subject} (${deps.now().toISOString().slice(0, 10)})`.slice(0, 200);

  /**
   * Deliver a newsletter that is already CLAIMED (`status = 'sending'`): create + start the campaign (or just start the
   * one a previous failed attempt created), then mark it `sent`, or `failed` with the error recorded in `stats.error`.
   * Never throws for provider failures.
   */
  async function deliver(claimed: Row): Promise<{ row: Row; warning: string | null }> {
    const html = render(claimed);
    const prov = provider();
    let campaignId = claimed.listmonkCampaignId;
    try {
      if (campaignId && prov.startCampaign) {
        await prov.startCampaign(String(campaignId));
      } else {
        const res = await prov.sendCampaign({ subject: claimed.subject, html, preheader: claimed.preheader ?? undefined, name: campaignName(claimed) });
        const n = Number(res.campaignId);
        campaignId = Number.isInteger(n) ? n : null;
      }
      let stats: NewsletterStats | null = null;
      if (campaignId) {
        try {
          const s = await prov.campaignStats(String(campaignId));
          stats = { sent: s.sent, toSend: s.toSend, views: s.views, clicks: s.clicks, bounces: s.bounces, ...(s.status ? { status: s.status } : {}) };
        } catch {
          /* stats are best effort right after sending */
        }
      }
      const [row] = await db
        .update(newsletter)
        .set({ status: "sent", sentAt: deps.now(), html, listmonkCampaignId: campaignId, stats, updatedAt: sql`now()` })
        .where(eq(newsletter.id, claimed.id))
        .returning();
      return { row: row!, warning: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failedCampaignId = err instanceof ListmonkError && err.campaignId ? Number(err.campaignId) : campaignId;
      deps.logger.error({ newsletterId: claimed.id, err: message }, "newsletter delivery failed");
      const [row] = await db
        .update(newsletter)
        .set({
          status: "failed",
          html,
          listmonkCampaignId: failedCampaignId && Number.isInteger(failedCampaignId) ? failedCampaignId : claimed.listmonkCampaignId,
          stats: { ...((claimed.stats as NewsletterStats | null) ?? {}), error: message, failedAt: deps.now().toISOString() },
          updatedAt: sql`now()`,
        })
        .where(eq(newsletter.id, claimed.id))
        .returning();
      return { row: row!, warning: `Sending failed: ${message}. The newsletter was marked as failed; fix the problem and send it again.` };
    }
  }

  /** Atomically move one newsletter to `sending` (only from a sendable state). Returns null when somebody else got there first. */
  async function claim(id: string): Promise<Row | null> {
    const [row] = await db
      .update(newsletter)
      .set({ status: "sending", updatedAt: sql`now()` })
      .where(and(eq(newsletter.id, id), inArray(newsletter.status, [...SENDABLE])))
      .returning();
    return row ?? null;
  }

  return {
    async list(q: ListNewslettersQuery): Promise<{ items: NewsletterSummary[]; total: number }> {
      const where = q.status ? eq(newsletter.status, q.status) : undefined;
      const [rows, [totals]] = await Promise.all([
        db
          .select()
          .from(newsletter)
          .where(where)
          .orderBy(desc(newsletter.createdAt), desc(newsletter.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db.select({ n: count() }).from(newsletter).where(where),
      ]);
      return { items: rows.map(toSummary), total: totals?.n ?? 0 };
    },

    async get(id: string): Promise<Newsletter> {
      return toNewsletter(await find(id));
    },

    async create(actor: Actor, input: CreateNewsletterInput): Promise<Newsletter> {
      let content: unknown = input.content ?? null;
      let preheader = input.preheader ?? null;
      let postId: string | null = input.postId ?? null;
      if (postId) {
        const [p] = await db
          .select({ id: post.id, title: post.title, slug: post.slug, section: post.section, content: post.content, excerpt: post.excerpt, coverImageUrl: post.coverImageUrl, coverImageAlt: post.coverImageAlt })
          .from(post)
          .where(eq(post.id, postId))
          .limit(1);
        if (!p) throw notFound("Post not found");
        if (!content) content = contentFromPost(p, deps.config.siteUrl);
        if (input.preheader === undefined) preheader = p.excerpt.trim() || null;
        postId = p.id;
      }
      if (content) assertValidContent(content);
      const [row] = await db.transaction(async (tx) => {
        const created = await tx
          .insert(newsletter)
          .values({
            subject: input.subject,
            preheader,
            postId,
            content: (content as Row["content"]) ?? null,
            html: render({ subject: input.subject, preheader, content }),
            createdBy: actor.id,
          })
          .returning();
        await audit(tx, actor, { action: "newsletter.create", targetType: "newsletter", targetId: created[0]!.id, meta: { subject: input.subject, postId } });
        return created;
      });
      return toNewsletter(row!);
    },

    async update(actor: Actor, id: string, input: UpdateNewsletterInput): Promise<Newsletter> {
      const existing = await find(id);
      if (!(EDITABLE as readonly string[]).includes(existing.status)) throw conflict(`A newsletter that is ${existing.status} cannot be edited`);
      const next = {
        subject: input.subject ?? existing.subject,
        preheader: input.preheader !== undefined ? input.preheader : existing.preheader,
        content: input.content !== undefined ? input.content : existing.content,
      };
      if (input.content) assertValidContent(input.content);
      if (input.postId) {
        const [p] = await db.select({ id: post.id }).from(post).where(eq(post.id, input.postId)).limit(1);
        if (!p) throw notFound("Post not found");
      }
      const [row] = await db.transaction(async (tx) => {
        const updated = await tx
          .update(newsletter)
          .set({
            subject: next.subject,
            preheader: next.preheader,
            content: next.content as Row["content"],
            ...(input.postId !== undefined ? { postId: input.postId } : {}),
            html: render(next),
            updatedAt: sql`now()`,
          })
          .where(and(eq(newsletter.id, id), inArray(newsletter.status, [...EDITABLE])))
          .returning();
        if (updated.length === 0) throw conflict("The newsletter is being sent and can no longer be edited");
        await audit(tx, actor, { action: "newsletter.update", targetType: "newsletter", targetId: id, meta: { fields: Object.keys(input) } });
        return updated;
      });
      return toNewsletter(row!);
    },

    async remove(actor: Actor, id: string): Promise<void> {
      const existing = await find(id);
      if (existing.status === "sending") throw conflict("The newsletter is being sent and cannot be deleted right now");
      await db.transaction(async (tx) => {
        const deleted = await tx.delete(newsletter).where(and(eq(newsletter.id, id), sql`${newsletter.status} <> 'sending'`)).returning({ id: newsletter.id });
        if (deleted.length === 0) throw conflict("The newsletter is being sent and cannot be deleted right now");
        await audit(tx, actor, { action: "newsletter.delete", targetType: "newsletter", targetId: id, meta: { subject: existing.subject, status: existing.status } });
      });
    },

    /** Fresh render of the current fields (not persisted); provider tags are replaced by inert anchors. */
    async preview(id: string): Promise<{ html: string }> {
      const row = await find(id);
      if (!row.content) return { html: previewHtml(renderNewsletterHtml(deps.config, { subject: row.subject, preheader: row.preheader, content: { root: { type: "root", children: [] } } })) };
      return { html: previewHtml(render(row)) };
    },

    async test(actor: Actor, id: string, email: string): Promise<{ sent: boolean; provider: "listmonk" | "noop"; warning: string | null }> {
      const row = await find(id);
      if (!row.content || isContentEmpty(row.content)) throw noContent();
      await audit(db, actor, { action: "newsletter.test", targetType: "newsletter", targetId: id, meta: { to: maskEmail(email) } });
      if (isNoop()) return { sent: false, provider: "noop", warning: NOOP_WARNING };
      try {
        await provider().testCampaign({ subject: `[Test] ${row.subject}`, to: email, html: render(row) });
      } catch (err) {
        deps.logger.error({ newsletterId: id, err: err instanceof Error ? err.message : String(err) }, "newsletter test send failed");
        throw new HttpError(502, "internal", `The newsletter provider could not send the test: ${err instanceof Error ? err.message : "unknown error"}`);
      }
      return { sent: true, provider: "listmonk", warning: null };
    },

    /**
     * Send now. Idempotent per newsletter: `draft|scheduled|failed → sending → sent|failed`; a second call on a `sent`
     * newsletter returns it unchanged, on a `sending` one → 409. Without a configured provider nothing is claimed and the
     * result carries a warning (`provider: "noop"`). A provider failure marks the newsletter `failed` (error in
     * `stats.error`) and is reported through `warning`, not as an HTTP error.
     */
    async send(actor: Actor, id: string): Promise<SendNewsletterResult> {
      const existing = await find(id);
      const providerName = isNoop() ? "noop" : "listmonk";
      if (existing.status === "sent") return { newsletter: toNewsletter(existing), provider: providerName, warning: null };
      if (existing.status === "sending") throw conflict("This newsletter is already being sent");
      if (!existing.content || isContentEmpty(existing.content)) throw noContent();
      if (isNoop()) return { newsletter: toNewsletter(existing), provider: "noop", warning: NOOP_WARNING };

      const claimed = await claim(id);
      if (!claimed) {
        const again = await find(id);
        if (again.status === "sent") return { newsletter: toNewsletter(again), provider: providerName, warning: null };
        throw conflict("This newsletter is already being sent");
      }
      const { row, warning } = await deliver(claimed);
      await audit(db, actor, { action: row.status === "sent" ? "newsletter.send" : "newsletter.send_failed", targetType: "newsletter", targetId: id, meta: { campaignId: row.listmonkCampaignId } });
      return { newsletter: toNewsletter(row), provider: "listmonk", warning };
    },

    async schedule(actor: Actor, id: string, scheduledFor: Date): Promise<Newsletter> {
      const existing = await find(id);
      if (!(SENDABLE as readonly string[]).includes(existing.status)) throw conflict(`A newsletter that is ${existing.status} cannot be scheduled`);
      if (!existing.content || isContentEmpty(existing.content)) throw noContent();
      if (scheduledFor.getTime() <= deps.now().getTime()) {
        throw new HttpError(422, "validation_error", "scheduledFor must be in the future", { details: [{ path: ["scheduledFor"], message: "must be in the future" }] });
      }
      if (isNoop()) throw conflict("The newsletter provider (listmonk) is not configured, so a newsletter cannot be scheduled");
      const [row] = await db.transaction(async (tx) => {
        const updated = await tx
          .update(newsletter)
          .set({ status: "scheduled", scheduledFor, html: render(existing), updatedAt: sql`now()` })
          .where(and(eq(newsletter.id, id), inArray(newsletter.status, [...SENDABLE])))
          .returning();
        if (updated.length === 0) throw conflict("The newsletter is being sent and cannot be scheduled");
        await audit(tx, actor, { action: "newsletter.schedule", targetType: "newsletter", targetId: id, meta: { scheduledFor: scheduledFor.toISOString() } });
        return updated;
      });
      return toNewsletter(row!);
    },

    /** Extension: `POST /admin/newsletters/:id/unschedule` — back to draft. */
    async unschedule(actor: Actor, id: string): Promise<Newsletter> {
      const existing = await find(id);
      if (existing.status !== "scheduled") throw conflict("Only a scheduled newsletter can be unscheduled");
      const [row] = await db.transaction(async (tx) => {
        const updated = await tx
          .update(newsletter)
          .set({ status: "draft", scheduledFor: null, updatedAt: sql`now()` })
          .where(and(eq(newsletter.id, id), eq(newsletter.status, "scheduled")))
          .returning();
        if (updated.length === 0) throw conflict("The newsletter is no longer scheduled");
        await audit(tx, actor, { action: "newsletter.unschedule", targetType: "newsletter", targetId: id });
        return updated;
      });
      return toNewsletter(row!);
    },

    /**
     * Campaign statistics. Pulls from the provider and caches them in `stats`; when the provider is unavailable the
     * cached stats are returned with `stale: true` (+ `error`), never an HTTP error.
     */
    async stats(id: string): Promise<NewsletterStats> {
      const row = await find(id);
      const cached = (row.stats as NewsletterStats | null) ?? {};
      if (!row.listmonkCampaignId || isNoop()) return cached;
      try {
        const s = await provider().campaignStats(String(row.listmonkCampaignId));
        const fresh: NewsletterStats = { sent: s.sent, toSend: s.toSend, views: s.views, clicks: s.clicks, bounces: s.bounces, ...(s.status ? { status: s.status } : {}), refreshedAt: deps.now().toISOString() };
        await db.update(newsletter).set({ stats: fresh }).where(eq(newsletter.id, id));
        return fresh;
      } catch (err) {
        return { ...cached, stale: true, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Cron: send every newsletter whose `scheduled_for` has passed. Each one is claimed with a conditional UPDATE, so
     * overlapping invocations never send the same newsletter twice. Stale `sending` rows become `failed`.
     */
    async sendDue(): Promise<DueResult> {
      const now = deps.now();
      const result: DueResult = { sent: 0, failed: 0, interrupted: 0 };
      const stale = await db
        .update(newsletter)
        .set({
          status: "failed",
          stats: sql`coalesce(${newsletter.stats}, '{}'::jsonb) || ${JSON.stringify({ error: "Sending was interrupted; check listmonk and send again", failedAt: now.toISOString() })}::jsonb`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(newsletter.status, "sending"), lte(newsletter.updatedAt, new Date(now.getTime() - STALE_SENDING_MS))))
        .returning({ id: newsletter.id });
      result.interrupted = stale.length;

      if (isNoop()) {
        const [due] = await db.select({ n: count() }).from(newsletter).where(and(eq(newsletter.status, "scheduled"), lte(newsletter.scheduledFor, now)));
        if ((due?.n ?? 0) > 0) {
          result.skipped = "newsletter provider not configured";
          deps.logger.warn({ due: due?.n }, "scheduled newsletters are due but no newsletter provider is configured");
        }
        return result;
      }

      const claimed = await db
        .update(newsletter)
        .set({ status: "sending", updatedAt: sql`now()` })
        .where(and(eq(newsletter.status, "scheduled"), lte(newsletter.scheduledFor, now)))
        .returning();
      for (const row of claimed) {
        const { row: done } = await deliver(row);
        await audit(db, null, { action: done.status === "sent" ? "newsletter.send_scheduled" : "newsletter.send_failed", targetType: "newsletter", targetId: row.id, meta: { campaignId: done.listmonkCampaignId } });
        if (done.status === "sent") result.sent++;
        else result.failed++;
      }
      return result;
    },
  };
}

export type NewsletterService = ReturnType<typeof createNewsletterService>;
