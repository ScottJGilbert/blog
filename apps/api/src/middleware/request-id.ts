import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Honour a sane inbound `x-request-id`; else reuse Vercel's `x-vercel-id` (`iad1::sfo1::abc12-1700000000000-9f8e7d6c5b4a`:
 * the last segment is unique per request and is what the runtime logs / support show), else mint one. Echoed on the response.
 */
export function resolveRequestId(req: Request): string {
  const inbound = req.headers["x-request-id"];
  const v = Array.isArray(inbound) ? inbound[0] : inbound;
  if (v && VALID.test(v)) return v;
  const vercel = req.headers["x-vercel-id"];
  const last = (Array.isArray(vercel) ? vercel[0] : vercel)?.split("::").pop();
  return last && VALID.test(last) ? last : randomUUID();
}

export const requestId: RequestHandler = (req, res, next) => {
  const id = resolveRequestId(req);
  (req as Request & { id: string }).id = id;
  res.setHeader("x-request-id", id);
  next();
};
