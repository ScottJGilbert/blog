import { ListPostsQuerySchema, RelatedPostsQuerySchema, SearchQuerySchema } from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { notFound } from "../../errors";
import { ok, paginated } from "../../lib/pagination";
import { parseQuery } from "../../lib/validate";
import type { PostsService } from "../../services/posts";
import { cachePublic } from "./cache";

/** `GET /posts`, `/posts/:slug`, `/posts/:slug/related`, `/search`, `/tags`, `/sitemap`. */
export function postsRouter(deps: Deps, posts: PostsService): Router {
  const router = Router();
  const read = deps.limiters.publicRead;

  router.get("/posts", read, async (req, res) => {
    const q = parseQuery(ListPostsQuerySchema, req);
    const { items, total } = await posts.list(q);
    cachePublic(res);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.get("/posts/:slug/related", read, async (req, res) => {
    const { limit } = parseQuery(RelatedPostsQuerySchema, req);
    const slug = String(req.params.slug);
    if (!(await posts.findPublishedRef(slug))) throw notFound("Post not found");
    const items = await posts.related(slug, limit);
    cachePublic(res);
    ok(res, items);
  });

  router.get("/posts/:slug", read, async (req, res) => {
    const post = await posts.getBySlug(String(req.params.slug));
    if (!post) throw notFound("Post not found");
    cachePublic(res); // Express adds a weak ETag (app-level `etag: weak`) and answers If-None-Match with 304
    ok(res, post);
  });

  router.get("/search", read, async (req, res) => {
    const q = parseQuery(SearchQuerySchema, req);
    const { items, total } = await posts.search(q);
    cachePublic(res);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.get("/tags", read, async (_req, res) => {
    const tags = await posts.tags();
    cachePublic(res);
    ok(res, tags);
  });

  router.get("/sitemap", read, async (_req, res) => {
    const entries = await posts.sitemap();
    cachePublic(res);
    ok(res, entries);
  });

  return router;
}
