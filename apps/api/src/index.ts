/**
 * Vercel (Services) entry: the default export is the Express app. Running this file directly
 * (`node dist/index.cjs`, i.e. `pnpm --filter @blog/api start`) also starts an HTTP server.
 *
 * Nothing here may throw at import time and nothing may listen when imported by the platform: a failing startup (bad env)
 * exports an app that answers 503 with a hint, and logs the reason once (see boot-failure.ts).
 */
import { pathToFileURL } from "node:url";
import type { Express } from "express";
import { createApp } from "./app";
import { createBootFailureApp, describeBootError, logBootFailure } from "./boot-failure";
import { loadConfig } from "./config";

let app: Express;
try {
  app = createApp();
} catch (err) {
  const failure = describeBootError(err);
  logBootFailure(failure);
  app = createBootFailureApp(failure);
}
export default app;

// Fluid compute reuses one instance for many concurrent requests: a stray rejection must be logged, not kill them all.
const guard = Symbol.for("@blog/api.rejection-guard");
const g = globalThis as { [guard]?: boolean };
if (process.env.VERCEL && !g[guard]) {
  g[guard] = true;
  process.on("unhandledRejection", (reason) => {
    console.error(JSON.stringify({ level: 50, msg: "unhandled rejection", err: reason instanceof Error ? reason.message : String(reason) }));
  });
}

const entry = process.argv[1];
if (!process.env.VERCEL && entry && import.meta.url === pathToFileURL(entry).href) {
  const { port } = loadConfig();
  const server = app.listen(port, () => {
    console.log(`[api] listening on http://localhost:${port}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
