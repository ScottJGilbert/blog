import type { RequestHandler } from "express";
import type { Config } from "../config";
import { forbidden } from "../errors";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function usesApiKey(headers: Record<string, string | string[] | undefined>): boolean {
  const auth = headers.authorization;
  const bearer = (Array.isArray(auth) ? auth[0] : auth)?.trim();
  return Boolean(headers["x-api-key"]) || Boolean(bearer && /^Bearer\s+blg_/i.test(bearer));
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests (not for Better Auth's own routes, which
 * validate Origin themselves). A POST/PUT/PATCH/DELETE that carries cookies must come from a trusted origin
 * (`Origin`, else `Referer`). API-key and cookie-less requests (cron, webhooks, curl) are not CSRF-able and pass.
 */
export function csrfOrigin(config: Pick<Config, "trustedOrigins">): RequestHandler {
  const allowed = new Set(config.trustedOrigins);
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    if (usesApiKey(req.headers)) return next();
    if (!req.headers.cookie) return next();
    const origin = originOf(req.headers.origin) ?? originOf(req.headers.referer);
    if (!origin || !allowed.has(origin)) throw forbidden("Cross-origin request blocked");
    next();
  };
}
