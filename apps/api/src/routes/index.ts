import express, { Router } from "express";
import type { Deps } from "../deps";
import { csrfOrigin } from "../middleware/csrf";
import { v1Cors } from "../middleware/cors";
import { requireAdmin } from "../middleware/auth";
import { adminRouter } from "./admin";
import { cronRouter } from "./cron";
import { healthRouter } from "./health";
import { mediaFilesRouter } from "./media-files";
import { meRouter } from "./me";
import { publicRouter } from "./public";
import { v1Router } from "./v1";

/**
 * The route registry. `createApp` mounts the returned router at API_BASE_PATH (default `/api`) AND at `/`
 * (Vercel Services may strip the prefix). Better Auth is mounted separately in `app.ts` (before the JSON parser).
 */
export function buildRouter(deps: Deps): Router {
  const router = Router();

  router.use(csrfOrigin(deps.config)); // state-changing + cookie-authenticated ⇒ trusted Origin required

  router.use(healthRouter(deps)); // GET /health
  router.use(meRouter(deps)); // GET/PATCH/DELETE /me
  router.use(mediaFilesRouter(deps)); // GET /media/files/*key (local storage driver)

  router.use("/v1", v1Cors, v1Router(deps)); // CORS * (GET only)
  router.use("/cron", cronRouter(deps)); // bearer CRON_SECRET
  // 4 MB JSON (inline editor images) is only ever parsed for an authenticated admin; `express.json` skips bodies already parsed
  router.use("/admin", deps.limiters.admin, requireAdmin, express.json({ limit: "4mb" }), adminRouter(deps));
  router.use(publicRouter(deps));

  return router;
}
