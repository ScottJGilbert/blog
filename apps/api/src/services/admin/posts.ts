import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  or,
  post,
  postEmbedding,
  postTag,
  sql,
  tag,
  user,
  type DbOrTx,
  type SQL,
} from "@blog/db";
import { isContentEmpty, readingMinutes, slugify, toExcerpt, toPlainText, validateContent } from "@blog/content";
import type {
  AdminListPostsQuery,
  AdminPostDetail,
  AdminPostSummary,
  CreatePostInput,
  LexicalContent,
  TagRef,
  UpdatePostInput,
} from "@blog/shared";
import type { Deps } from "../../deps";
import { HttpError, conflict, notFound } from "../../errors";
import { audit } from "../../lib/audit";
import { postTags } from "../../lib/revalidate";
import { createMediaService } from "../media";
import { embedPost } from "../posts";
import { isUniqueViolation, iso, likePattern } from "./common";

type PostRow = typeof post.$inferSelect;
type Actor = { id: string };

const EXCERPT_LENGTH = 200;

const listColumns = {
  id: post.id,
  slug: post.slug,
  title: post.title,
  excerpt: post.excerpt,
  section: post.section,
  status: post.status,
  coverImageUrl: post.coverImageUrl,
  publishedAt: post.publishedAt,
  scheduledFor: post.scheduledFor,
  readingMinutes: post.readingMinutes,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  authorId: user.id,
  authorName: user.name,
  authorImage: user.image,
};
type ListRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  section: PostRow["section"];
  status: PostRow["status"];
  coverImageUrl: string | null;
  publishedAt: Date | null;
  scheduledFor: Date | null;
  readingMinutes: number;
  createdAt: Date;
  updatedAt: Date;
  authorId: string;
  authorName: string;
  authorImage: string | null;
};

function toSummary(r: ListRow, tags: TagRef[]): AdminPostSummary {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    section: r.section,
    status: r.status,
    tags,
    coverImageUrl: r.coverImageUrl,
    author: { id: r.authorId, name: r.authorName, image: r.authorImage },
    publishedAt: iso(r.publishedAt),
    scheduledFor: iso(r.scheduledFor),
    readingMinutes: r.readingMinutes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function loadTagMap(db: DbOrTx, ids: string[]): Promise<Map<string, TagRef[]>> {
  const map = new Map<string, TagRef[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ postId: postTag.postId, slug: tag.slug, name: tag.name })
    .from(postTag)
    .innerJoin(tag, eq(tag.id, postTag.tagId))
    .where(inArray(postTag.postId, ids))
    .orderBy(tag.name);
  for (const r of rows) {
    const list = map.get(r.postId) ?? [];
    list.push({ slug: r.slug, name: r.name });
    map.set(r.postId, list);
  }
  return map;
}

/** Unique tag names → `{slug, name}` (slugified, de-duplicated by slug, first spelling wins). */
export function normaliseTags(names: string[]): Array<{ slug: string; name: string }> {
  const seen = new Map<string, { slug: string; name: string }>();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const slug = slugify(name, "tag");
    if (!seen.has(slug)) seen.set(slug, { slug, name });
  }
  return [...seen.values()];
}

/** Upsert tags by slug and make `postId`'s tag set exactly `names`. */
async function replaceTags(tx: DbOrTx, postId: string, names: string[]): Promise<void> {
  const tags = normaliseTags(names);
  if (tags.length === 0) {
    await tx.delete(postTag).where(eq(postTag.postId, postId));
    return;
  }
  await tx.insert(tag).values(tags).onConflictDoNothing({ target: tag.slug });
  const rows = await tx
    .select({ id: tag.id })
    .from(tag)
    .where(inArray(tag.slug, tags.map((t) => t.slug)));
  const ids = rows.map((r) => r.id);
  await tx.delete(postTag).where(and(eq(postTag.postId, postId), notInArray(postTag.tagId, ids)));
  await tx
    .insert(postTag)
    .values(ids.map((tagId) => ({ postId, tagId })))
    .onConflictDoNothing();
}

/** First free slug of `base`, `base-2`, `base-3`, … */
async function allocateSlug(tx: DbOrTx, base: string, excludeId?: string): Promise<string> {
  const rows = await tx
    .select({ id: post.id, slug: post.slug })
    .from(post)
    .where(or(eq(post.slug, base), ilike(post.slug, `${base}-%`)));
  const used = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug));
  if (!used.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function contentIssues(content: unknown): { warnings: number } {
  const v = validateContent(content);
  if (!v.ok) {
    throw new HttpError(422, "validation_error", "The post content is not valid", {
      details: v.errors.map((e) => ({ path: ["content", e.path], code: e.code, message: e.message })),
    });
  }
  return { warnings: v.warnings.length };
}

const emptyPostError = () => new HttpError(422, "validation_error", "Cannot publish or schedule a post without content", { details: [{ path: ["content"], message: "Content is empty" }] });

export interface MutationResult {
  post: AdminPostDetail;
  /** number of non-blocking content warnings (unknown nodes etc.) */
  warnings: number;
}

export function createAdminPostsService(deps: Deps) {
  const { db } = deps;
  const media = createMediaService(deps);

  async function detail(id: string, tx: DbOrTx = db): Promise<AdminPostDetail> {
    const [row] = await tx
      .select({ ...listColumns, content: post.content, coverImageAlt: post.coverImageAlt })
      .from(post)
      .innerJoin(user, eq(user.id, post.authorId))
      .where(eq(post.id, id))
      .limit(1);
    if (!row) throw notFound("Post not found");
    const [tags, emb] = await Promise.all([
      loadTagMap(tx, [id]),
      tx.select({ n: count() }).from(postEmbedding).where(eq(postEmbedding.postId, id)),
    ]);
    return {
      ...toSummary(row, tags.get(id) ?? []),
      content: row.content as LexicalContent,
      coverImageAlt: row.coverImageAlt,
      hasEmbedding: (emb[0]?.n ?? 0) > 0,
    };
  }

  async function find(id: string, tx: DbOrTx = db): Promise<PostRow> {
    const [row] = await tx.select().from(post).where(eq(post.id, id)).limit(1);
    if (!row) throw notFound("Post not found");
    return row;
  }

  /** Fire-and-forget embedding (best effort; `embedPost` never throws, the catch is belt and braces). */
  function embedInBackground(id: string): void {
    void embedPost(deps, id).catch((err) => deps.logger.warn({ err: String(err), postId: id }, "background embedding failed"));
  }

  async function revalidate(rows: Array<{ slug: string; section: string }>): Promise<void> {
    const tags = new Set<string>(["tags"]);
    for (const r of rows) for (const t of postTags(r)) tags.add(t);
    await deps.revalidate([...tags]);
  }

  return {
    detail,

    async list(q: AdminListPostsQuery): Promise<{ items: AdminPostSummary[]; total: number }> {
      const conds: SQL[] = [];
      if (q.status) conds.push(eq(post.status, q.status));
      if (q.section) conds.push(eq(post.section, q.section));
      if (q.q) {
        const pattern = likePattern(q.q);
        conds.push(or(ilike(post.title, pattern), ilike(post.slug, pattern), ilike(post.excerpt, pattern))!);
      }
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [totals]] = await Promise.all([
        db
          .select(listColumns)
          .from(post)
          .innerJoin(user, eq(user.id, post.authorId))
          .where(where)
          .orderBy(desc(post.updatedAt), desc(post.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db.select({ n: count() }).from(post).where(where),
      ]);
      const tags = await loadTagMap(db, rows.map((r) => r.id));
      return { items: rows.map((r) => toSummary(r, tags.get(r.id) ?? [])), total: totals?.n ?? 0 };
    },

    async get(id: string): Promise<AdminPostDetail> {
      return detail(id);
    },

    async create(actor: Actor, input: CreatePostInput): Promise<MutationResult> {
      const { warnings } = contentIssues(input.content);
      const status = input.status ?? "draft";
      if (status === "scheduled") {
        throw new HttpError(422, "validation_error", "Use POST /admin/posts/:id/schedule to schedule a post", { details: [{ path: ["status"], message: "scheduled is not accepted here" }] });
      }
      if (status === "published" && isContentEmpty(input.content)) throw emptyPostError();

      const ext = await media.externalizeDataImages(input.content);
      const content = ext.content as LexicalContent;
      const text = toPlainText(content);
      const excerpt = input.excerpt?.trim() ? input.excerpt.trim() : toExcerpt(content, EXCERPT_LENGTH);
      const now = deps.now();

      let id = "";
      let attempts = 0;
      try {
        for (;;) {
          attempts++;
          try {
            id = await db.transaction(async (tx) => {
              const slug = input.slug ?? (await allocateSlug(tx, slugify(input.title, "post")));
              const [row] = await tx
                .insert(post)
                .values({
                  slug,
                  title: input.title,
                  excerpt,
                  section: input.section,
                  status,
                  content,
                  contentText: text,
                  coverImageUrl: input.coverImageUrl ?? null,
                  coverImageAlt: input.coverImageAlt ?? null,
                  authorId: actor.id,
                  publishedAt: status === "published" ? now : null,
                  readingMinutes: readingMinutes(content),
                })
                .returning({ id: post.id });
              await replaceTags(tx, row!.id, input.tags);
              await media.insertMediaRows(tx, ext.files, actor.id);
              await audit(tx, actor, {
                action: "post.create",
                targetType: "post",
                targetId: row!.id,
                meta: { slug, title: input.title, status, ...(ext.files.length ? { images: ext.files.length } : {}) },
              });
              return row!.id;
            });
            break;
          } catch (err) {
            if (isUniqueViolation(err, "post_slug_unique")) {
              if (input.slug) throw conflict("A post with this slug already exists", { slug: input.slug });
              if (attempts < 5) continue; // lost a race for the derived slug: allocate again
            }
            throw err;
          }
        }
      } catch (err) {
        await media.discard(ext.files);
        throw err;
      }

      const created = await detail(id);
      if (created.status === "published") {
        await revalidate([created]);
        embedInBackground(id);
      }
      return { post: created, warnings };
    },

    async update(actor: Actor, id: string, input: UpdatePostInput): Promise<MutationResult> {
      const existing = await find(id);
      const patch: Partial<typeof post.$inferInsert> = {};
      let warnings = 0;
      let files: Awaited<ReturnType<typeof media.externalizeDataImages>>["files"] = [];
      const changed: string[] = [];

      let content = existing.content as LexicalContent;
      if (input.content !== undefined) {
        warnings = contentIssues(input.content).warnings;
        const ext = await media.externalizeDataImages(input.content);
        files = ext.files;
        content = ext.content as LexicalContent;
        patch.content = content;
        patch.contentText = toPlainText(content);
        patch.readingMinutes = readingMinutes(content);
        changed.push("content");
      }
      if (input.title !== undefined && input.title !== existing.title) {
        patch.title = input.title;
        changed.push("title");
      }
      if (input.section !== undefined && input.section !== existing.section) {
        patch.section = input.section;
        changed.push("section");
      }
      if (input.coverImageUrl !== undefined) {
        patch.coverImageUrl = input.coverImageUrl;
        if (input.coverImageUrl === null && input.coverImageAlt === undefined) patch.coverImageAlt = null;
        changed.push("coverImageUrl");
      }
      if (input.coverImageAlt !== undefined) {
        patch.coverImageAlt = input.coverImageAlt;
        changed.push("coverImageAlt");
      }

      // excerpt: explicit value wins; blank → auto; untouched auto-excerpts follow content changes
      if (input.excerpt !== undefined) {
        patch.excerpt = input.excerpt.trim() ? input.excerpt.trim() : toExcerpt(content, EXCERPT_LENGTH);
        changed.push("excerpt");
      } else if (input.content !== undefined) {
        const wasAuto = existing.excerpt === "" || existing.excerpt === toExcerpt(existing.content, EXCERPT_LENGTH);
        if (wasAuto) {
          patch.excerpt = toExcerpt(content, EXCERPT_LENGTH);
          changed.push("excerpt");
        }
      }

      // status transitions
      let status = existing.status;
      if (input.status !== undefined && input.status !== existing.status) {
        if (input.status === "scheduled") {
          await media.discard(files);
          throw new HttpError(422, "validation_error", "Use POST /admin/posts/:id/schedule to schedule a post", { details: [{ path: ["status"], message: "scheduled is not accepted here" }] });
        }
        status = input.status;
        patch.status = status;
        patch.scheduledFor = null;
        if (status === "published") patch.publishedAt = existing.publishedAt ?? deps.now();
        changed.push("status");
      }
      if (status === "published" && isContentEmpty(content)) {
        await media.discard(files);
        throw emptyPostError();
      }

      try {
        await db.transaction(async (tx) => {
          if (input.slug !== undefined && input.slug !== existing.slug) {
            const [clash] = await tx.select({ id: post.id }).from(post).where(eq(post.slug, input.slug)).limit(1);
            if (clash) throw conflict("A post with this slug already exists", { slug: input.slug });
            patch.slug = input.slug;
            changed.push("slug");
          }
          if (Object.keys(patch).length > 0 || input.tags !== undefined) {
            await tx
              .update(post)
              .set({ ...patch, updatedAt: sql`now()` })
              .where(eq(post.id, id));
          }
          if (input.tags !== undefined) {
            await replaceTags(tx, id, input.tags);
            changed.push("tags");
          }
          await media.insertMediaRows(tx, files, actor.id);
          await audit(tx, actor, {
            action: "post.update",
            targetType: "post",
            targetId: id,
            meta: { slug: patch.slug ?? existing.slug, fields: changed, ...(files.length ? { images: files.length } : {}) },
          });
        });
      } catch (err) {
        await media.discard(files);
        if (isUniqueViolation(err, "post_slug_unique")) throw conflict("A post with this slug already exists", { slug: input.slug });
        throw err;
      }

      const updated = await detail(id);
      if (existing.status === "published" || updated.status === "published") {
        await revalidate([existing, updated]);
      }
      if (updated.status === "published") embedInBackground(id);
      return { post: updated, warnings };
    },

    async publish(actor: Actor, id: string): Promise<AdminPostDetail> {
      const existing = await find(id);
      if (isContentEmpty(existing.content)) throw emptyPostError();
      if (existing.status !== "published") {
        await db.transaction(async (tx) => {
          await tx
            .update(post)
            .set({ status: "published", publishedAt: existing.publishedAt ?? deps.now(), scheduledFor: null, updatedAt: sql`now()` })
            .where(eq(post.id, id));
          await audit(tx, actor, { action: "post.publish", targetType: "post", targetId: id, meta: { slug: existing.slug, from: existing.status } });
        });
      }
      const updated = await detail(id);
      await revalidate([updated]);
      embedInBackground(id);
      return updated;
    },

    async unpublish(actor: Actor, id: string): Promise<AdminPostDetail> {
      const existing = await find(id);
      if (existing.status !== "draft") {
        await db.transaction(async (tx) => {
          // published_at is kept so a later re-publish keeps the original date
          await tx.update(post).set({ status: "draft", scheduledFor: null, updatedAt: sql`now()` }).where(eq(post.id, id));
          await audit(tx, actor, { action: "post.unpublish", targetType: "post", targetId: id, meta: { slug: existing.slug, from: existing.status } });
        });
      }
      const updated = await detail(id);
      await revalidate([updated]);
      return updated;
    },

    async schedule(actor: Actor, id: string, scheduledFor: Date): Promise<AdminPostDetail> {
      const existing = await find(id);
      if (existing.status === "published") throw conflict("The post is already published; unpublish it before scheduling");
      if (scheduledFor.getTime() <= deps.now().getTime()) {
        throw new HttpError(422, "validation_error", "scheduledFor must be in the future", { details: [{ path: ["scheduledFor"], message: "must be in the future" }] });
      }
      if (isContentEmpty(existing.content)) throw emptyPostError();
      await db.transaction(async (tx) => {
        await tx.update(post).set({ status: "scheduled", scheduledFor, updatedAt: sql`now()` }).where(eq(post.id, id));
        await audit(tx, actor, { action: "post.schedule", targetType: "post", targetId: id, meta: { slug: existing.slug, scheduledFor: scheduledFor.toISOString() } });
      });
      return detail(id);
    },

    async remove(actor: Actor, id: string): Promise<void> {
      const existing = await find(id);
      await db.transaction(async (tx) => {
        await tx.delete(post).where(eq(post.id, id));
        await audit(tx, actor, { action: "post.delete", targetType: "post", targetId: id, meta: { slug: existing.slug, title: existing.title, status: existing.status } });
      });
      await revalidate([existing]);
    },
  };
}

export type AdminPostsService = ReturnType<typeof createAdminPostsService>;
