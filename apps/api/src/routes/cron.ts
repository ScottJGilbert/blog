import { Router } from "express";
import type { Deps } from "../deps";

/**
 * Cron endpoints, mounted at `/cron`. Authenticated with `Authorization: Bearer $CRON_SECRET`
 * (see `bearerMatches` in `lib/crypto.ts`), NOT with a session.
 *
 * WP B2 implements — `POST /cron/publish-scheduled`.
 */
export function cronRouter(_deps: Deps): Router {
  const router = Router();
  return router;
}
