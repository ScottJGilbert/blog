import { sql } from "@blog/db";
import { Router } from "express";
import type { Deps } from "../deps";

async function dbUp(deps: Deps): Promise<boolean> {
  try {
    await Promise.race([
      deps.db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000).unref()),
    ]);
    return true;
  } catch (err) {
    deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "health: database check failed");
    return false;
  }
}

/** `GET /health` → `{ status: "ok", db: "up" | "down", version }` — always 200, never leaks DB errors. */
export function healthRouter(deps: Deps): Router {
  const router = Router();
  router.get("/health", async (_req, res) => {
    res.set("cache-control", "no-store");
    res.json({ status: "ok", db: (await dbUp(deps)) ? "up" : "down", version: deps.config.version });
  });
  return router;
}
