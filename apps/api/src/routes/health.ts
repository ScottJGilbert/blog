import { sql } from "@blog/db";
import { Router, type Request } from "express";
import { configWarnings, missingConfig } from "../config";
import type { Deps } from "../deps";
import { bearerMatches, safeEqual } from "../lib/crypto";

/** Long enough for a Neon compute waking from idle (1-3 s), short enough that a probe never hangs the instance. */
export const HEALTH_DB_TIMEOUT_MS = 4000;

async function dbUp(deps: Deps): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      deps.db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), HEALTH_DB_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "health: database check failed");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Diagnostics are for operators: `Authorization: Bearer $CRON_SECRET` or `x-revalidate-secret: $REVALIDATE_SECRET`. */
export function isOperator(req: Request, deps: Pick<Deps, "config">): boolean {
  const { cronSecret, revalidate } = deps.config;
  const header = req.headers["x-revalidate-secret"];
  const provided = Array.isArray(header) ? header[0] : header;
  return Boolean((cronSecret && bearerMatches(req.headers.authorization, cronSecret)) || (revalidate.secret && provided && safeEqual(provided, revalidate.secret)));
}

/**
 * `GET /health` → `{ status: "ok", db: "up" | "down", version }` — always 200, never leaks DB errors.
 * For operators (see `isOperator`) it adds `config`: env var NAMES that are missing, warnings, and the resolved (non-secret)
 * origins / drivers, which is what you need to debug a fresh Vercel deployment.
 */
export function healthRouter(deps: Deps): Router {
  const router = Router();
  router.get("/health", async (req, res) => {
    res.set("cache-control", "no-store");
    const { config } = deps;
    const body: Record<string, unknown> = { status: "ok", db: (await dbUp(deps)) ? "up" : "down", version: config.version };
    if (isOperator(req, deps)) {
      body.config = {
        missing: missingConfig(config),
        warnings: configWarnings(config),
        onVercel: config.onVercel,
        vercelEnv: config.vercelEnv ?? null,
        siteUrl: config.siteUrl,
        authUrl: config.authUrl,
        trustedOrigins: config.trustedOrigins,
        storage: deps.storage.driver,
        mailer: deps.mailer.driver,
        rateLimitStore: config.rateLimit.store,
        revalidate: { source: config.revalidate.source, host: config.revalidate.url ? new URL(config.revalidate.url).host : null },
      };
    }
    res.json(body);
  });
  return router;
}
