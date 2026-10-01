import { AdminListPostsQuerySchema, CreatePostInputSchema, SchedulePostInputSchema, UpdatePostInputSchema } from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { ok, paginated } from "../../lib/pagination";
import { parseBody, parseQuery } from "../../lib/validate";
import { actorOf, uuidParam } from "../../services/admin/common";
import { createAdminPostsService } from "../../services/admin/posts";

/** `/admin/posts` — SPEC §5.5. Mutations answer with the full `AdminPostDetail`; DELETE with 204. */
export function adminPostsRouter(deps: Deps): Router {
  const router = Router();
  const svc = createAdminPostsService(deps);

  router.get("/posts", async (req, res) => {
    const q = parseQuery(AdminListPostsQuerySchema, req);
    const { items, total } = await svc.list(q);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.get("/posts/:id", async (req, res) => {
    ok(res, await svc.get(uuidParam(req)));
  });

  router.post("/posts", async (req, res) => {
    const input = parseBody(CreatePostInputSchema, req);
    const { post, warnings } = await svc.create(actorOf(req), input);
    if (warnings > 0) res.set("x-content-warnings", String(warnings));
    ok(res, post, 201);
  });

  router.patch("/posts/:id", async (req, res) => {
    const input = parseBody(UpdatePostInputSchema, req);
    const { post, warnings } = await svc.update(actorOf(req), uuidParam(req), input);
    if (warnings > 0) res.set("x-content-warnings", String(warnings));
    ok(res, post);
  });

  router.delete("/posts/:id", async (req, res) => {
    await svc.remove(actorOf(req), uuidParam(req));
    res.status(204).end();
  });

  router.post("/posts/:id/publish", async (req, res) => {
    ok(res, await svc.publish(actorOf(req), uuidParam(req)));
  });

  router.post("/posts/:id/unpublish", async (req, res) => {
    ok(res, await svc.unpublish(actorOf(req), uuidParam(req)));
  });

  router.post("/posts/:id/schedule", async (req, res) => {
    const { scheduledFor } = parseBody(SchedulePostInputSchema, req);
    ok(res, await svc.schedule(actorOf(req), uuidParam(req), new Date(scheduledFor)));
  });

  return router;
}
