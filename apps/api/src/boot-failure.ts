import express, { type Express } from "express";
import { ConfigError } from "./config";
import { bearerMatches, safeEqual } from "./lib/crypto";

export interface BootFailure {
  message: string;
  /** env var NAMES (never values) the failure points at */
  variables: string[];
}

export function describeBootError(err: unknown): BootFailure {
  if (err instanceof ConfigError) return { message: err.message, variables: err.variables };
  return { message: err instanceof Error ? err.message : String(err), variables: [] };
}

/** One structured line on stderr (same shape as pino, so Vercel's runtime logs show it next to the request logs). */
export function logBootFailure(failure: BootFailure): void {
  console.error(JSON.stringify({ level: 60, msg: "api failed to start", error: failure.message, variables: failure.variables }));
}

/**
 * What the serverless function exports when the real app cannot be built (missing / invalid environment, a library that
 * rejects its options). Importing the module must never throw: that is a crash loop with a generic platform 500 and no hint.
 * Every request answers a clean 503 envelope; `/health` also does, and tells operators (CRON_SECRET / REVALIDATE_SECRET
 * holders) which variables to fix.
 */
export function createBootFailureApp(failure: BootFailure, env: Record<string, string | undefined> = process.env): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res) => {
    const header = req.headers["x-revalidate-secret"];
    const provided = Array.isArray(header) ? header[0] : header;
    const operator = Boolean(
      (env.CRON_SECRET && bearerMatches(req.headers.authorization, env.CRON_SECRET)) ||
        (env.REVALIDATE_SECRET && provided && safeEqual(provided, env.REVALIDATE_SECRET)),
    );
    const health = /\/health\/?$/.test(req.path);
    res.status(503).set({ "cache-control": "no-store", "retry-after": "30" }).json({
      error: { code: "internal", message: "The API is misconfigured and cannot start. Check the deployment's runtime logs." },
      ...(health ? { status: "error", db: "unknown" } : {}),
      ...(operator ? { config: { error: failure.message, missing: failure.variables } } : {}),
    });
  });
  return app;
}
