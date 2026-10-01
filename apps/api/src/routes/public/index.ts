import { Router } from "express";
import type { Deps } from "../../deps";

/**
 * Public (reader-facing) routes, mounted at the API root: posts, search, tags, related, comments, newsletter,
 * `/me/subscription`, RSS/sitemap.
 *
 * WP B1 implements — add routers/handlers here. Example:
 *   router.get("/posts", deps.limiters.publicRead, async (req, res) => { ... paginated(res, {...}) });
 */
export function publicRouter(_deps: Deps): Router {
  const router = Router();
  return router;
}
