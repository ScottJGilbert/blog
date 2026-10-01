/**
 * Open-redirect protection for `?next=`: only same-origin absolute PATHS are accepted
 * (`/account`, `/personal/foo?x=1`). Anything else (`//evil.com`, `https://…`, `/\evil.com`,
 * control characters, auth loops) falls back to `fallback`.
 */
export function safeNext(value: string | string[] | null | undefined, fallback = "/"): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "string") return fallback;
  if (raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  try {
    const base = "http://internal.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return fallback;
    // Dot segments are collapsed by the URL parser: `/.//evil.com` becomes `//evil.com`, which a browser (and
    // router.replace) would treat as a protocol-relative URL. Re-check the NORMALISED result.
    const out = url.pathname + url.search + url.hash;
    if (!out.startsWith("/") || out.startsWith("//") || out.startsWith("/\\")) return fallback;
    if (/^\/(login|signup|forgot-password|reset-password|verify-email|auth)(\/|$)/i.test(url.pathname)) return fallback;
    return out;
  } catch {
    return fallback;
  }
}
