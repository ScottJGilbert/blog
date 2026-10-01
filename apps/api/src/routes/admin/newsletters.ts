import {
  CreateNewsletterInputSchema,
  ListNewslettersQuerySchema,
  ListSubscribersQuerySchema,
  ScheduleNewsletterInputSchema,
  TestNewsletterInputSchema,
  UpdateNewsletterInputSchema,
} from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { makeLimiter } from "../../middleware/rate-limit";
import { ok, paginated } from "../../lib/pagination";
import { parseBody, parseQuery } from "../../lib/validate";
import { actorOf, uuidParam } from "../../services/admin/common";
import { createNewsletterService } from "../../services/newsletter/service";
import { createSubscribersService } from "../../services/newsletter/subscribers";

/**
 * `/admin/newsletters` and `/admin/subscribers` (SPEC §5.5, §5.7).
 *
 * Quirks the admin UI must know:
 *  - `POST /:id/send` answers 200 with `{ newsletter, provider, warning }`. `provider: "noop"` + a `warning` means nothing was
 *    delivered and the newsletter was NOT marked sent. A provider failure also answers 200: `newsletter.status === "failed"`,
 *    `newsletter.stats.error` holds the reason and `warning` repeats it.
 *  - `POST /:id/test` answers 200 `{ data: { sent, provider, warning } }` (the shared client types it as void).
 *  - `POST /:id/unschedule` (extension) moves a scheduled newsletter back to draft.
 */
export function adminNewslettersRouter(deps: Deps): Router {
  const router = Router();
  const svc = createNewsletterService(deps);
  const subscribers = createSubscribersService(deps);
  // 5 test e-mails / minute / admin (a test send reaches a real inbox)
  const testLimiter = makeLimiter(deps.config.rateLimit.enabled, {
    windowMs: 60_000,
    limit: 5,
    key: (req) => `newsletter-test:${req.user?.id ?? req.ip}`,
    message: "Too many test sends, please wait a minute.",
  });

  router.get("/newsletters", async (req, res) => {
    const q = parseQuery(ListNewslettersQuerySchema, req);
    const { items, total } = await svc.list(q);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  router.post("/newsletters", async (req, res) => {
    ok(res, await svc.create(actorOf(req), parseBody(CreateNewsletterInputSchema, req)), 201);
  });

  router.get("/newsletters/:id", async (req, res) => {
    ok(res, await svc.get(uuidParam(req)));
  });

  router.patch("/newsletters/:id", async (req, res) => {
    ok(res, await svc.update(actorOf(req), uuidParam(req), parseBody(UpdateNewsletterInputSchema, req)));
  });

  router.delete("/newsletters/:id", async (req, res) => {
    await svc.remove(actorOf(req), uuidParam(req));
    res.status(204).end();
  });

  router.post("/newsletters/:id/preview", async (req, res) => {
    ok(res, await svc.preview(uuidParam(req)));
  });

  router.post("/newsletters/:id/test", testLimiter, async (req, res) => {
    const { email } = parseBody(TestNewsletterInputSchema, req);
    ok(res, await svc.test(actorOf(req), uuidParam(req), email));
  });

  router.post("/newsletters/:id/send", async (req, res) => {
    ok(res, await svc.send(actorOf(req), uuidParam(req)));
  });

  router.post("/newsletters/:id/schedule", async (req, res) => {
    const { scheduledFor } = parseBody(ScheduleNewsletterInputSchema, req);
    ok(res, await svc.schedule(actorOf(req), uuidParam(req), new Date(scheduledFor)));
  });

  router.post("/newsletters/:id/unschedule", async (req, res) => {
    ok(res, await svc.unschedule(actorOf(req), uuidParam(req)));
  });

  router.get("/newsletters/:id/stats", async (req, res) => {
    ok(res, await svc.stats(uuidParam(req)));
  });

  // ----- subscribers -------------------------------------------------------------------------------------------
  router.get("/subscribers", async (req, res) => {
    const q = parseQuery(ListSubscribersQuerySchema, req);
    const { items, total } = await subscribers.list(q);
    paginated(res, { data: items, total, page: q.page, pageSize: q.pageSize });
  });

  // registered before `/subscribers/:id` so "sync" is never taken for an id (different method anyway)
  router.post("/subscribers/sync", async (req, res) => {
    ok(res, await subscribers.sync(actorOf(req)));
  });

  router.delete("/subscribers/:id", async (req, res) => {
    await subscribers.remove(actorOf(req), uuidParam(req));
    res.status(204).end();
  });

  return router;
}
