import { Router, type Request, type Response } from "express";
import type { Deps } from "../deps";
import { HttpError, unauthorized } from "../errors";
import { bearerMatches } from "../lib/crypto";
import { publishDuePosts } from "../services/admin/scheduled";
import { createNewsletterService } from "../services/newsletter/service";

/**
 * Cron endpoints, mounted at `/cron`. Authenticated with `Authorization: Bearer $CRON_SECRET` (NOT with a session).
 *
 * `POST|GET /cron/publish-scheduled` (Vercel Cron issues GET) publishes due scheduled posts and sends due scheduled
 * newsletters. 401 without/with a wrong secret, 503 when `CRON_SECRET` is unset in production (so a misconfigured deploy
 * fails loudly instead of being open). Safe to run concurrently and repeatedly (claims are conditional UPDATEs).
 *
 * vercel.json (owned by the lead):  "crons": [{ "path": "/api/cron/publish-scheduled", "schedule": "* * * * *" }]
 * (Hobby plans only allow daily crons; use an external scheduler hitting this URL every minute otherwise.)
 */
export function cronRouter(deps: Deps): Router {
  const router = Router();
  const newsletters = createNewsletterService(deps);

  function authorize(req: Request): void {
    const secret = deps.config.cronSecret;
    if (!secret) {
      if (deps.config.isProd) throw new HttpError(503, "internal", "CRON_SECRET is not configured");
      throw unauthorized("CRON_SECRET is not configured; cron endpoints are disabled");
    }
    if (!bearerMatches(req.headers.authorization, secret)) throw unauthorized("Invalid cron credentials");
  }

  const handler = async (req: Request, res: Response) => {
    authorize(req);
    // the two jobs are independent: a failure in one must not starve the other (the first error is rethrown afterwards → 500)
    const [posts, newsletterResult] = await Promise.allSettled([publishDuePosts(deps), newsletters.sendDue()]);
    if (posts.status === "rejected" || newsletterResult.status === "rejected") {
      const reason = posts.status === "rejected" ? posts.reason : (newsletterResult as PromiseRejectedResult).reason;
      deps.logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "cron job failed");
      throw reason;
    }
    res.set("cache-control", "no-store");
    res.json({ data: { posts: posts.value, newsletters: newsletterResult.value } });
  };

  router.get("/publish-scheduled", handler);
  router.post("/publish-scheduled", handler);
  return router;
}
