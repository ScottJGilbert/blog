import type { Request } from "express";
import { z } from "zod";
import { notFound, unauthorized } from "../../errors";

/** The authenticated admin of a request (set by `requireAdmin`). */
export function actorOf(req: Request): Express.SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

const Uuid = z.uuid();

/** Route param that must be a UUID; anything else is a plain 404 (never a database error). */
export function uuidParam(req: Request, name = "id"): string {
  const raw = req.params[name];
  const parsed = Uuid.safeParse(raw);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

/** Text-id param (Better Auth user ids): bounded and printable, else 404. */
export function textIdParam(req: Request, name = "id"): string {
  const raw = req.params[name];
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 128 || !/^[\w.@:-]+$/.test(raw)) throw notFound();
  return raw;
}

/** `%…%` ILIKE pattern with wildcards in user input escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Walk `cause` chains (drizzle wraps driver errors) to the pg error. */
export function pgError(err: unknown): PgErrorLike | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const e = cur as PgErrorLike;
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    cur = e.cause;
  }
  return null;
}

/** unique_violation (optionally for one constraint name). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  return e?.code === "23505" && (constraint === undefined || e.constraint === constraint);
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
