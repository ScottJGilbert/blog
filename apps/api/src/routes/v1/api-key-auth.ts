import { and, apiKey, eq, isNull, or, lt, sql } from "@blog/db";
import type { ApiKeyScope } from "@blog/shared";
import type { RequestHandler } from "express";
import type { Deps } from "../../deps";
import { forbidden, unauthorized } from "../../errors";
import { sha256Hex } from "../../lib/crypto";
import { API_KEY_FORMAT } from "../../services/admin/api-keys";

/** `last_used_at` is written at most this often per key (keeps hot keys from turning every read into a write). */
export const LAST_USED_THROTTLE_MS = 60_000;

/** The raw key a request presents: `x-api-key`, or `Authorization: Bearer blg_…`. `undefined` = anonymous. */
export function presentedKey(headers: Record<string, string | string[] | undefined>): string | undefined {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();
  const x = one(headers["x-api-key"]);
  if (x) return x;
  const auth = one(headers.authorization);
  const m = auth ? /^Bearer\s+(blg_\S*)$/i.exec(auth) : null;
  return m ? m[1] : undefined;
}

/**
 * `/v1` API-key middleware. No key → anonymous (public data only). A presented key must exist and not be revoked,
 * otherwise 401. Keys are looked up by their sha256 (the plaintext is never stored or compared), validated against the
 * `blg_<43 url-safe chars>` format first so garbage never reaches the database. Sets `req.apiKey = { id, scopes }`.
 */
export function apiKeyAuth(deps: Deps): RequestHandler {
  return async (req, _res, next) => {
    const key = presentedKey(req.headers);
    if (key === undefined) return next();
    if (!API_KEY_FORMAT.test(key)) throw unauthorized("Invalid API key");

    const [row] = await deps.db
      .select({ id: apiKey.id, scopes: apiKey.scopes, revokedAt: apiKey.revokedAt })
      .from(apiKey)
      .where(eq(apiKey.keyHash, sha256Hex(key)))
      .limit(1);
    if (!row || row.revokedAt) throw unauthorized("Invalid or revoked API key");
    req.apiKey = { id: row.id, scopes: row.scopes as ApiKeyScope[] };

    const now = deps.now();
    try {
      await deps.db
        .update(apiKey)
        .set({ lastUsedAt: now })
        .where(and(eq(apiKey.id, row.id), or(isNull(apiKey.lastUsedAt), lt(apiKey.lastUsedAt, sql`${new Date(now.getTime() - LAST_USED_THROTTLE_MS).toISOString()}::timestamptz`))));
    } catch (err) {
      deps.logger.warn({ err: String(err) }, "could not record API key usage");
    }
    next();
  };
}

/** Guard: the request must carry a key with `scope` (401 without a key, 403 when the key lacks the scope). */
export function requireScope(scope: ApiKeyScope): RequestHandler {
  return (req, _res, next) => {
    if (!req.apiKey) throw unauthorized(`This endpoint requires an API key with the "${scope}" scope`);
    if (!req.apiKey.scopes.includes(scope)) throw forbidden(`The API key does not have the "${scope}" scope`);
    next();
  };
}
