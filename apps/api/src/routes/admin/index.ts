import { Router } from "express";
import type { Deps } from "../../deps";
import { adminCommentsRouter } from "./comments";
import { adminMediaRouter } from "./media";
import { adminMiscRouter } from "./misc";
import { adminNewslettersRouter } from "./newsletters";
import { adminPostsRouter } from "./posts";
import { adminUsersRouter } from "./users";

/**
 * Admin routes, mounted at `/admin` already behind `requireAdmin` (+ the `deps.limiters.admin` limiter and CSRF check).
 * `req.user` is the verified admin. Every mutation writes an `audit_log` row (`lib/audit`).
 *
 *   posts          GET/POST /posts, GET/PATCH/DELETE /posts/:id, POST /posts/:id/{publish,unpublish,schedule}
 *   media          GET/POST /media, PATCH/DELETE /media/:id
 *   users          GET /users, GET/PATCH/DELETE /users/:id, POST /users/:id/{ban,unban}
 *   comments       GET /comments, PATCH /comments/:id, POST /comments/:id/resolve-reports
 *   newsletters    CRUD + preview/test/send/schedule/unschedule/stats; subscribers list/delete/sync
 *   misc           api-keys, stats, system, embeddings/reindex
 */
export function adminRouter(deps: Deps): Router {
  const router = Router();
  router.use(adminPostsRouter(deps));
  router.use(adminMediaRouter(deps));
  router.use(adminUsersRouter(deps));
  router.use(adminCommentsRouter(deps));
  router.use(adminNewslettersRouter(deps));
  router.use(adminMiscRouter(deps));
  return router;
}
