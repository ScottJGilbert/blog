import { BanUserInputSchema, ListUsersQuerySchema, UpdateUserInputSchema } from "@blog/shared";
import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../../deps";
import { ok, paginated } from "../../lib/pagination";
import { parseBody, parseQuery } from "../../lib/validate";
import { actorOf, textIdParam } from "../../services/admin/common";
import { createAdminUsersService } from "../../services/admin/users";

const DeleteUserQuery = z.object({ reassignTo: z.string().trim().min(1).max(128).optional() });

/**
 * `/admin/users`. Guard rails: you cannot change the role of, ban or delete yourself (403), nor the last active
 * administrator (409). `DELETE /users/:id` answers 409 while the user owns posts unless `?reassignTo=<adminId>` moves them.
 */
export function adminUsersRouter(deps: Deps): Router {
  const router = Router();
  const svc = createAdminUsersService(deps);

  router.get("/users", async (req, res) => {
    const q = parseQuery(ListUsersQuerySchema, req);
    const { items, total } = await svc.list(q);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.get("/users/:id", async (req, res) => {
    ok(res, await svc.get(textIdParam(req)));
  });

  router.patch("/users/:id", async (req, res) => {
    ok(res, await svc.update(actorOf(req), textIdParam(req), parseBody(UpdateUserInputSchema, req)));
  });

  router.post("/users/:id/ban", async (req, res) => {
    ok(res, await svc.ban(actorOf(req), textIdParam(req), parseBody(BanUserInputSchema, req)));
  });

  router.post("/users/:id/unban", async (req, res) => {
    ok(res, await svc.unban(actorOf(req), textIdParam(req)));
  });

  router.delete("/users/:id", async (req, res) => {
    const { reassignTo } = parseQuery(DeleteUserQuery, req);
    await svc.remove(actorOf(req), textIdParam(req), { reassignTo });
    res.status(204).end();
  });

  return router;
}
