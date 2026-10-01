import type { Request, RequestHandler } from "express";
import { forbidden, unauthorized } from "../errors";
import { loadSession } from "../auth";

async function authenticate(req: Request): Promise<Express.SessionUser> {
  const s = await loadSession(req);
  if (!s) throw unauthorized();
  if (s.banned) throw forbidden("This account has been suspended.");
  req.user = s.user;
  return s.user;
}

/** Attach `req.user` when a valid session exists; never rejects. */
export const optionalUser: RequestHandler = async (req, _res, next) => {
  const s = await loadSession(req);
  if (s && !s.banned) req.user = s.user;
  next();
};

/** 401 without a session, 403 for suspended accounts. Sets `req.user`. */
export const requireUser: RequestHandler = async (req, _res, next) => {
  await authenticate(req);
  next();
};

/** requireUser + verified email (needed to comment). */
export const requireVerifiedUser: RequestHandler = async (req, _res, next) => {
  const user = await authenticate(req);
  if (!user.emailVerified) throw forbidden("Please verify your email address first.");
  next();
};

/** requireUser + role `admin` (401 / 403). */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const user = await authenticate(req);
  if (user.role !== "admin") throw forbidden("Administrator access required.");
  next();
};
