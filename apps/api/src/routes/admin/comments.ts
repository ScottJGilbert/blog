import { AdminListCommentsQuerySchema, UpdateCommentStatusInputSchema } from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { ok, paginated } from "../../lib/pagination";
import { parseBody, parseQuery } from "../../lib/validate";
import { actorOf, uuidParam } from "../../services/admin/common";
import { createAdminCommentsService } from "../../services/admin/comments";

/** `/admin/comments` — moderation queue (status / reported filters), status changes, resolving reports. */
export function adminCommentsRouter(deps: Deps): Router {
  const router = Router();
  const svc = createAdminCommentsService(deps);

  router.get("/comments", async (req, res) => {
    const q = parseQuery(AdminListCommentsQuerySchema, req);
    const { items, total } = await svc.list(q);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.patch("/comments/:id", async (req, res) => {
    const { status } = parseBody(UpdateCommentStatusInputSchema, req);
    ok(res, await svc.setStatus(actorOf(req), uuidParam(req), status));
  });

  router.post("/comments/:id/resolve-reports", async (req, res) => {
    ok(res, await svc.resolveReports(actorOf(req), uuidParam(req)));
  });

  return router;
}
