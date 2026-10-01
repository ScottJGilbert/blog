import { CreateApiKeyInputSchema } from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { audit } from "../../lib/audit";
import { ok } from "../../lib/pagination";
import { parseBody } from "../../lib/validate";
import { actorOf, uuidParam } from "../../services/admin/common";
import { createAdminApiKeysService } from "../../services/admin/api-keys";
import { createAdminStatsService } from "../../services/admin/stats";
import { reindexAll } from "../../services/posts";

/** `/admin/api-keys`, `/admin/stats`, `/admin/system`, `/admin/embeddings/reindex`. */
export function adminMiscRouter(deps: Deps): Router {
  const router = Router();
  const stats = createAdminStatsService(deps);
  const keys = createAdminApiKeysService(deps);

  router.get("/stats", async (_req, res) => {
    ok(res, await stats.stats());
  });

  router.get("/system", async (_req, res) => {
    ok(res, await stats.system());
  });

  // ----- API keys: the plaintext key is in the 201 response ONLY ---------------------------------------------------
  router.get("/api-keys", async (_req, res) => {
    ok(res, await keys.list());
  });

  router.post("/api-keys", async (req, res) => {
    ok(res, await keys.create(actorOf(req), parseBody(CreateApiKeyInputSchema, req)), 201);
  });

  router.delete("/api-keys/:id", async (req, res) => {
    await keys.revoke(actorOf(req), uuidParam(req));
    res.status(204).end();
  });

  // ----- embeddings ---------------------------------------------------------------------------------------------
  /** 202 `{ enabled: true, queued }` when re-embedding started; 200 `{ enabled: false, queued: 0 }` when no provider is configured. */
  router.post("/embeddings/reindex", async (req, res) => {
    const actor = actorOf(req);
    if (!deps.embeddings.enabled) {
      ok(res, { enabled: false, queued: 0 });
      return;
    }
    const { queued } = await reindexAll(deps);
    await audit(deps.db, actor, { action: "embeddings.reindex", meta: { queued, model: deps.embeddings.model } });
    ok(res, { enabled: true, queued }, 202);
  });

  return router;
}
