import { Router } from "express";
import type { Deps } from "../../deps";

/**
 * Admin routes, mounted at `/admin` already behind `requireAdmin` (+ the `deps.limiters.admin` limiter and CSRF check).
 * `req.user` is the verified admin. Every mutation must call `audit(deps.db, req.user, {...})`.
 *
 * WP B2 implements — posts, media, users, comments, newsletters, subscribers, api-keys, stats, embeddings/reindex.
 */
export function adminRouter(_deps: Deps): Router {
  const router = Router();
  return router;
}
