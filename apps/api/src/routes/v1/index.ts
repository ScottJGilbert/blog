import { Router } from "express";
import type { Deps } from "../../deps";

/**
 * External read-only API, mounted at `/v1` with CORS `*` (GET only) already applied by `routes/index.ts`.
 *
 * WP B2 implements — posts, posts/:slug, tags, search, comments, openapi.json; API-key middleware (sets `req.apiKey`),
 * `deps.limiters.publicRead`, `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` + ETag.
 */
export function v1Router(_deps: Deps): Router {
  const router = Router();
  return router;
}
