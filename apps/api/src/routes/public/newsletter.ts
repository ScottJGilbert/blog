import { ConfirmSubscriptionInputSchema, SetSubscriptionInputSchema, SubscribeInputSchema, UnsubscribeQuerySchema } from "@blog/shared";
import { escapeHtml } from "@blog/content";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Deps } from "../../deps";
import { HttpError, unauthorized } from "../../errors";
import { safeEqual } from "../../lib/crypto";
import { ok } from "../../lib/pagination";
import { parseBody, parse } from "../../lib/validate";
import { requireUser, requireVerifiedUser } from "../../middleware/auth";
import type { SubscribersService } from "../../services/subscribers";
import { noStore } from "./cache";

function unsubscribePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1c1b1b}h1{font-size:1.4rem}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

/** Token from the JSON body, or (RFC 8058 one-click POSTs carry it in the URL) from the query string. */
function tokenFrom(req: Request): string {
  const fromQuery = typeof req.query.token === "string" ? req.query.token : undefined;
  const fromBody = req.body && typeof req.body === "object" && typeof (req.body as { token?: unknown }).token === "string" ? (req.body as { token: string }).token : undefined;
  return parse(UnsubscribeQuerySchema, { token: fromBody ?? fromQuery }).token;
}

/** Public newsletter flows (SPEC §5.4), `/me/subscription` and the listmonk webhook. */
export function newsletterRouter(deps: Deps, subscribers: SubscribersService): Router {
  const router = Router();
  const limit = deps.limiters.subscribe;

  router.post("/newsletter/subscribe", limit, async (req, res) => {
    const input = parseBody(SubscribeInputSchema, req);
    await subscribers.subscribe(input.email, input.source);
    noStore(res);
    // Same answer whether the address is new, pending, confirmed or unsubscribed (no enumeration).
    res.status(202).json({ data: { status: "pending" } });
  });

  router.post("/newsletter/confirm", limit, async (req, res) => {
    const { token } = parseBody(ConfirmSubscriptionInputSchema, req);
    noStore(res);
    ok(res, await subscribers.confirm(token));
  });

  router.post("/newsletter/unsubscribe", limit, async (req, res) => {
    const token = tokenFrom(req);
    noStore(res);
    ok(res, await subscribers.unsubscribe(token));
  });

  // List-Unsubscribe one-click target: a small HTML confirmation page (JSON errors are useless in a mail client).
  router.get("/newsletter/unsubscribe", limit, async (req, res) => {
    noStore(res);
    res.type("html");
    const parsed = UnsubscribeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).send(unsubscribePage("Invalid link", "This unsubscribe link is incomplete. Use the link from the email you received."));
      return;
    }
    try {
      await subscribers.unsubscribe(parsed.data.token);
      res.status(200).send(unsubscribePage("You are unsubscribed", "You will no longer receive emails from us. You can subscribe again at any time."));
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        res.status(404).send(unsubscribePage("Link not recognised", "This unsubscribe link is not valid. If you keep receiving emails, reply to one of them and we will remove you."));
        return;
      }
      throw err;
    }
  });

  // ----- signed-in users ---------------------------------------------------------------------------------------------
  router.get("/me/subscription", requireUser, async (req, res) => {
    noStore(res);
    ok(res, await subscribers.getForUser(req.user!));
  });

  router.put("/me/subscription", requireVerifiedUser, async (req, res) => {
    const { subscribed } = parseBody(SetSubscriptionInputSchema, req);
    noStore(res);
    ok(res, subscribed ? await subscribers.subscribeUser(req.user!) : await subscribers.unsubscribeUser(req.user!));
  });

  router.delete("/me/subscription", requireUser, async (req, res) => {
    await subscribers.deleteForUser(req.user!);
    res.status(204).end();
  });

  // ----- listmonk → us -----------------------------------------------------------------------------------------------
  router.post("/webhooks/listmonk", async (req, res) => {
    const secret = deps.config.listmonk.webhookSecret;
    const given = req.headers["x-webhook-secret"];
    if (!secret || typeof given !== "string" || !safeEqual(given, secret)) throw unauthorized("Invalid webhook secret");
    const result = await handleListmonkEvent(subscribers, req.body);
    ok(res, result);
  });

  return router;
}

const WebhookBodySchema = z.looseObject({});

/** Best effort over the payload shapes listmonk (and typical bounce/postback webhooks) produce. */
export async function handleListmonkEvent(subscribers: SubscribersService, body: unknown): Promise<{ handled: boolean; updated: number }> {
  const parsed = WebhookBodySchema.safeParse(body);
  if (!parsed.success) return { handled: false, updated: 0 };
  const b = parsed.data as Record<string, unknown>;
  const nested = (k: string): Record<string, unknown> => (b[k] && typeof b[k] === "object" ? (b[k] as Record<string, unknown>) : {});
  const sub = nested("subscriber");
  const data = nested("data");
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.includes("@") ? v : undefined);
  const email = str(b.email) ?? str(sub.email) ?? str(data.email) ?? str(b.recipient) ?? str(b.subscriber_email);
  const rawId = sub.id ?? data.subscriber_id ?? b.subscriber_id ?? (typeof b.id === "number" ? b.id : undefined);
  const listmonkId = typeof rawId === "number" ? rawId : typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : undefined;
  const event = String(b.event ?? b.type ?? b.action ?? "").toLowerCase();
  const status = String(sub.status ?? b.status ?? "").toLowerCase();
  const wantsRemoval = /unsub|blocklist|bounce|complaint|spam/.test(event) || status === "blocklisted" || status === "unsubscribed";
  if (!wantsRemoval || (!email && listmonkId == null)) return { handled: false, updated: 0 };
  const updated = await subscribers.markUnsubscribedFromProvider({ email, listmonkId });
  return { handled: true, updated };
}
