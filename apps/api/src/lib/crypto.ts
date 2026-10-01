import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (length differences do not short-circuit on content). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");
/** URL-safe random token (default 32 bytes → 43 chars). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** Check an `Authorization: Bearer <secret>` header against `secret` in constant time. */
export function bearerMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? safeEqual(m[1]!.trim(), secret) : false;
}
