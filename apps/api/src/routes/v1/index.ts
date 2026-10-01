import { comment, and, asc, count, desc, eq, exists, inArray, isNull, post, sql, user } from "@blog/db";
import { ListPostsQuerySchema, SearchQuerySchema, V1ListCommentsQuerySchema, type V1Comment, type V1CommentReply } from "@blog/shared";
import { alias } from "drizzle-orm/pg-core";
import { Router, type RequestHandler, type Response } from "express";
import type { Deps } from "../../deps";
import { HttpError, notFound } from "../../errors";
import { ok, paginated } from "../../lib/pagination";
import { parseQuery } from "../../lib/validate";
import { createPostsService } from "../../services/posts";
import { apiKeyAuth, requireScope } from "./api-key-auth";
import { buildOpenApiDocument } from "./openapi";

export const V1_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Shared-cache headers for success responses only (errors are never marked cacheable). */
function cacheable(res: Response): void {
  res.set("Cache-Control", V1_CACHE_CONTROL);
}

/** `X-RateLimit-*` derived from express-rate-limit's `req.rateLimit` (present when rate limiting is enabled). */
const rateLimitHeaders: RequestHandler = (req, res, next) => {
  const info = (req as unknown as { rateLimit?: { limit: number; remaining: number; resetTime?: Date } }).rateLimit;
  if (info) {
    res.set("X-RateLimit-Limit", String(info.limit));
    res.set("X-RateLimit-Remaining", String(Math.max(0, info.remaining)));
    if (info.resetTime) res.set("X-RateLimit-Reset", String(Math.ceil(info.resetTime.getTime() / 1000)));
    res.append("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
  }
  next();
};

/**
 * External read-only API, mounted at `/v1` with CORS `*` (GET only) already applied by `routes/index.ts`.
 *
 *   GET /v1/posts, /v1/posts/:slug, /v1/tags, /v1/search     public (an API key only raises the rate limit)
 *   GET /v1/comments?postSlug=                                needs an API key with the `comments:read` scope
 *   GET /v1/openapi.json                                      OpenAPI 3.1 description
 *
 * Responses carry `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` and a weak ETag (Express answers
 * `If-None-Match` with 304). Query strings are validated strictly: unknown parameters → 400.
 */
export function v1Router(deps: Deps): Router {
  const router = Router();
  const posts = createPostsService(deps);

  router.use((req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    throw new HttpError(405, "validation_error", "The /v1 API is read-only (GET only)", { headers: { allow: "GET, HEAD, OPTIONS" } });
  });

  router.get("/openapi.json", (_req, res) => {
    cacheable(res);
    res.json(buildOpenApiDocument(deps.config));
  });

  router.use(apiKeyAuth(deps));
  router.use(deps.limiters.publicRead);
  router.use(rateLimitHeaders);

  router.get("/posts", async (req, res) => {
    const q = parseQuery(ListPostsQuerySchema.strict(), req);
    const { items, total } = await posts.list(q);
    cacheable(res);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.get("/posts/:slug", async (req, res) => {
    const slug = req.params.slug;
    if (typeof slug !== "string" || slug.length > 200) throw notFound("Post not found");
    const found = await posts.getBySlug(slug);
    if (!found) throw notFound("Post not found");
    cacheable(res);
    ok(res, found);
  });

  router.get("/tags", async (_req, res) => {
    const tags = await posts.tags();
    cacheable(res);
    ok(res, tags);
  });

  router.get("/search", async (req, res) => {
    const q = parseQuery(SearchQuerySchema.strict(), req);
    const { items, total } = await posts.search(q);
    cacheable(res);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.get("/comments", requireScope("comments:read"), async (req, res) => {
    const q = parseQuery(V1ListCommentsQuerySchema.strict(), req);
    const now = deps.now();
    const [target] = await deps.db
      .select({ id: post.id })
      .from(post)
      .where(and(eq(post.slug, q.postSlug), sql`${post.status} = 'published' AND ${post.publishedAt} <= ${now.toISOString()}::timestamptz`))
      .limit(1);
    if (!target) throw notFound("Post not found");

    const r = alias(comment, "r");
    const visibleReplyExists = exists(
      deps.db
        .select({ one: sql`1` })
        .from(r)
        .where(and(eq(r.parentId, comment.id), eq(r.status, "visible"))),
    );
    const topLevel = and(
      eq(comment.postId, target.id),
      isNull(comment.parentId),
      // a deleted comment is kept (as "[deleted]") only to hold its visible replies; hidden ones disappear with their thread
      sql`(${comment.status} = 'visible' or (${comment.status} = 'deleted' and ${visibleReplyExists}))`,
    );
    const [rows, [totals]] = await Promise.all([
      deps.db
        .select({
          id: comment.id,
          parentId: comment.parentId,
          body: comment.body,
          status: comment.status,
          createdAt: comment.createdAt,
          editedAt: comment.editedAt,
          authorName: user.name,
          authorImage: user.image,
        })
        .from(comment)
        .leftJoin(user, eq(user.id, comment.authorId))
        .where(topLevel)
        .orderBy(desc(comment.createdAt), desc(comment.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      deps.db.select({ n: count() }).from(comment).where(topLevel),
    ]);

    const ids = rows.map((r) => r.id);
    const replyRows = ids.length
      ? await deps.db
          .select({
            id: comment.id,
            parentId: comment.parentId,
            body: comment.body,
            createdAt: comment.createdAt,
            editedAt: comment.editedAt,
            authorName: user.name,
            authorImage: user.image,
          })
          .from(comment)
          .leftJoin(user, eq(user.id, comment.authorId))
          .where(and(inArray(comment.parentId, ids), eq(comment.status, "visible")))
          .orderBy(asc(comment.createdAt), asc(comment.id))
      : [];
    const repliesByParent = new Map<string, V1CommentReply[]>();
    for (const r of replyRows) {
      const list = repliesByParent.get(r.parentId!) ?? [];
      list.push({
        id: r.id,
        parentId: r.parentId,
        body: r.body,
        author: { name: r.authorName ?? "Deleted user", image: r.authorName ? r.authorImage : null },
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt ? r.editedAt.toISOString() : null,
      });
      repliesByParent.set(r.parentId!, list);
    }
    const data: V1Comment[] = rows.map((r) => {
      const gone = r.status !== "visible";
      return {
        id: r.id,
        parentId: null,
        body: gone ? "[deleted]" : r.body,
        author: gone || !r.authorName ? { name: "Deleted user", image: null } : { name: r.authorName, image: r.authorImage },
        createdAt: r.createdAt.toISOString(),
        editedAt: gone || !r.editedAt ? null : r.editedAt.toISOString(),
        replies: repliesByParent.get(r.id) ?? [],
      };
    });
    // authenticated + per-key scoped data: never store it in a shared cache
    res.set("Cache-Control", "private, max-age=60");
    res.append("Vary", "Authorization, X-API-Key");
    paginated(res, { data, total: totals?.n ?? 0, page: q.page, pageSize: q.pageSize });
  });

  return router;
}
