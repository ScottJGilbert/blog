import { and, eq, inArray, ne, or, subscriber, user } from "@blog/db";
import type { Deps } from "../../deps";
import { badRequest, notFound } from "../../errors";
import { randomToken } from "../../lib/crypto";
import { newsletterConfirmEmail } from "../mailer/templates";

export const CONFIRM_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;
export const CONFIRM_RESEND_INTERVAL_MS = 5 * 60_000;

/**
 * Confirmation tokens are `<issued-at seconds, base36>.<32 random bytes, base64url>`. The issue time lets us enforce the
 * 7-day expiry and the "at most one confirmation mail per 5 minutes" rule without an extra column; the random part
 * carries all the entropy and the whole string is looked up in the (unique) `confirm_token` column.
 */
export function issueConfirmToken(now: Date): string {
  return `${Math.floor(now.getTime() / 1000).toString(36)}.${randomToken(32)}`;
}

/** Issue time of a token produced by `issueConfirmToken`, or null for anything else. */
export function confirmTokenIssuedAt(token: string | null): Date | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const secs = parseInt(token.slice(0, dot), 36);
  return Number.isFinite(secs) ? new Date(secs * 1000) : null;
}

type SubscriberRow = typeof subscriber.$inferSelect;

export function createSubscribersService(deps: Deps) {
  const { db } = deps;
  const siteUrl = deps.config.siteUrl.replace(/\/+$/, "");

  /** Push to the newsletter provider (best effort); returns the numeric provider id when there is one. */
  async function pushToProvider(email: string, name?: string): Promise<number | null> {
    try {
      const { externalId } = await deps.newsletter.upsertSubscriber(email, name);
      return /^\d+$/.test(externalId) ? Number(externalId) : null;
    } catch (err) {
      deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "newsletter provider: upsertSubscriber failed (continuing)");
      return null;
    }
  }

  async function removeFromProvider(row: Pick<SubscriberRow, "email" | "listmonkSubscriberId">): Promise<void> {
    try {
      await deps.newsletter.removeSubscriber(row.listmonkSubscriberId != null ? String(row.listmonkSubscriberId) : row.email);
    } catch (err) {
      deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "newsletter provider: removeSubscriber failed (continuing)");
    }
  }

  const byUser = (u: { id: string; email: string }) => or(eq(subscriber.userId, u.id), eq(subscriber.email, u.email.toLowerCase()));

  return {
    /**
     * Double opt-in entry point. Never reveals whether the address is known: callers always answer 202.
     * Already confirmed → nothing; pending and mailed < 5 minutes ago → nothing; otherwise (re)issue a token and mail it.
     */
    async subscribe(email: string, source?: string): Promise<void> {
      const now = deps.now();
      const [existing] = await db.select().from(subscriber).where(eq(subscriber.email, email)).limit(1);
      if (existing?.status === "confirmed") return;
      if (existing?.status === "pending") {
        const issued = confirmTokenIssuedAt(existing.confirmToken);
        if (issued && now.getTime() - issued.getTime() < CONFIRM_RESEND_INTERVAL_MS) return;
      }
      const token = issueConfirmToken(now);
      let unsubscribeToken: string;
      if (existing) {
        unsubscribeToken = existing.unsubscribeToken;
        await db
          .update(subscriber)
          .set({ status: "pending", confirmToken: token, unsubscribedAt: null, source: existing.source ?? source ?? null })
          .where(eq(subscriber.id, existing.id));
      } else {
        unsubscribeToken = randomToken(32);
        const inserted = await db
          .insert(subscriber)
          .values({ email, status: "pending", confirmToken: token, unsubscribeToken, source: source ?? null, createdAt: now })
          .onConflictDoNothing({ target: subscriber.email })
          .returning({ id: subscriber.id });
        if (inserted.length === 0) return; // lost a race with a concurrent request: that one sends the mail
      }
      try {
        const rendered = newsletterConfirmEmail({
          siteName: deps.config.siteName,
          url: `${siteUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`,
          unsubscribeUrl: `${siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
        });
        await deps.mailer.send({ to: email, ...rendered });
      } catch (err) {
        deps.logger.error({ err: err instanceof Error ? err.message : String(err) }, "failed to send newsletter confirmation mail");
      }
    },

    /** Confirm by token (valid 7 days; idempotent for an already confirmed subscriber). */
    async confirm(token: string): Promise<{ status: "confirmed" }> {
      const [row] = await db.select().from(subscriber).where(eq(subscriber.confirmToken, token)).limit(1);
      const invalid = () => badRequest("This confirmation link is invalid or has expired. Please subscribe again.");
      if (!row || row.status === "unsubscribed") throw invalid();
      if (row.status === "confirmed") return { status: "confirmed" };
      const now = deps.now();
      const issued = confirmTokenIssuedAt(row.confirmToken);
      if (!issued || now.getTime() - issued.getTime() > CONFIRM_TOKEN_TTL_MS) throw invalid();

      const claimed = await db
        .update(subscriber)
        .set({ status: "confirmed", confirmedAt: now, unsubscribedAt: null })
        .where(and(eq(subscriber.id, row.id), eq(subscriber.status, "pending")))
        .returning({ id: subscriber.id });
      if (claimed.length === 0) return { status: "confirmed" }; // concurrent confirm won

      const [account] = await db.select({ id: user.id, emailVerified: user.emailVerified }).from(user).where(eq(user.email, row.email)).limit(1);
      const listmonkId = await pushToProvider(row.email);
      const extra = {
        ...(listmonkId != null ? { listmonkSubscriberId: listmonkId } : {}),
        ...(account?.emailVerified && !row.userId ? { userId: account.id } : {}),
      };
      if (Object.keys(extra).length > 0) await db.update(subscriber).set(extra).where(eq(subscriber.id, row.id));
      return { status: "confirmed" };
    },

    /** Unsubscribe by the (secret, per-subscriber) unsubscribe token. Idempotent. */
    async unsubscribe(token: string): Promise<{ status: "unsubscribed" }> {
      const [row] = await db.select().from(subscriber).where(eq(subscriber.unsubscribeToken, token)).limit(1);
      if (!row) throw notFound("This unsubscribe link is not valid.");
      if (row.status !== "unsubscribed") {
        await db.update(subscriber).set({ status: "unsubscribed", unsubscribedAt: deps.now(), confirmToken: null }).where(eq(subscriber.id, row.id));
        await removeFromProvider(row);
      }
      return { status: "unsubscribed" };
    },

    // ----- signed-in users ---------------------------------------------------------------------------------------
    async getForUser(u: { id: string; email: string }): Promise<{ status: SubscriberRow["status"] } | null> {
      const [row] = await db.select({ status: subscriber.status }).from(subscriber).where(byUser(u)).limit(1);
      return row ? { status: row.status } : null;
    },

    /** Verified users subscribe instantly (no double opt-in needed: the address is already verified). */
    async subscribeUser(u: { id: string; email: string; name: string }): Promise<{ status: "confirmed" }> {
      const now = deps.now();
      const email = u.email.toLowerCase();
      const [existing] = await db.select().from(subscriber).where(byUser(u)).limit(1);
      let row = existing;
      if (!row) {
        const inserted = await db
          .insert(subscriber)
          .values({ email, userId: u.id, status: "confirmed", unsubscribeToken: randomToken(32), source: "account", createdAt: now, confirmedAt: now })
          .onConflictDoNothing({ target: subscriber.email })
          .returning();
        row = inserted[0] ?? (await db.select().from(subscriber).where(eq(subscriber.email, email)).limit(1))[0];
      } else if (row.status !== "confirmed") {
        await db.update(subscriber).set({ status: "confirmed", userId: u.id, confirmedAt: now, unsubscribedAt: null, confirmToken: null }).where(eq(subscriber.id, row.id));
      } else if (row.userId !== u.id) {
        await db.update(subscriber).set({ userId: u.id }).where(eq(subscriber.id, row.id));
      }
      if (row && (row.listmonkSubscriberId == null || row.status !== "confirmed")) {
        const id = await pushToProvider(email, u.name);
        if (id != null) await db.update(subscriber).set({ listmonkSubscriberId: id }).where(eq(subscriber.id, row.id));
      }
      return { status: "confirmed" };
    },

    /** `subscribed: false` → status `unsubscribed` (row kept); null when the user never subscribed. */
    async unsubscribeUser(u: { id: string; email: string }): Promise<{ status: "unsubscribed" } | null> {
      const rows = await db.select().from(subscriber).where(byUser(u));
      if (rows.length === 0) return null;
      for (const row of rows) {
        if (row.status !== "unsubscribed") {
          await db.update(subscriber).set({ status: "unsubscribed", unsubscribedAt: deps.now(), confirmToken: null }).where(eq(subscriber.id, row.id));
          await removeFromProvider(row);
        }
      }
      return { status: "unsubscribed" };
    },

    /** Remove the record entirely (and from the provider). */
    async deleteForUser(u: { id: string; email: string }): Promise<void> {
      const rows = await db.select().from(subscriber).where(byUser(u));
      for (const row of rows) await removeFromProvider(row);
      if (rows.length) await db.delete(subscriber).where(inArray(subscriber.id, rows.map((r) => r.id)));
    },

    /** Provider → us: mark addresses as unsubscribed (unsubscribe/blocklist/bounce events). Returns rows touched. */
    async markUnsubscribedFromProvider(match: { email?: string; listmonkId?: number }): Promise<number> {
      const conds = [];
      if (match.email) conds.push(eq(subscriber.email, match.email.toLowerCase()));
      if (match.listmonkId != null) conds.push(eq(subscriber.listmonkSubscriberId, match.listmonkId));
      if (conds.length === 0) return 0;
      const updated = await db
        .update(subscriber)
        .set({ status: "unsubscribed", unsubscribedAt: deps.now(), confirmToken: null })
        .where(and(or(...conds), ne(subscriber.status, "unsubscribed")))
        .returning({ id: subscriber.id });
      return updated.length;
    },
  };
}

export type SubscribersService = ReturnType<typeof createSubscribersService>;
