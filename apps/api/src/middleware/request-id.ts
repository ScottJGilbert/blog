import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

/** Honour a sane inbound `x-request-id`, else mint one; echo it on the response. */
export function resolveRequestId(req: Request): string {
  const inbound = req.headers["x-request-id"];
  const v = Array.isArray(inbound) ? inbound[0] : inbound;
  return v && VALID.test(v) ? v : randomUUID();
}

export const requestId: RequestHandler = (req, res, next) => {
  const id = resolveRequestId(req);
  (req as Request & { id: string }).id = id;
  res.setHeader("x-request-id", id);
  next();
};
