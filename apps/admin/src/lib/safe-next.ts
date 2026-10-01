/**
 * Open-redirect-safe handling of the `?next=` parameter used by the login flow.
 * Only same-origin, app-relative paths are allowed. Paths are relative to the Next `basePath` (`/admin`), i.e. what
 * `router.replace()` / `redirect()` expect (`/posts`, not `/admin/posts`).
 */
export const DEFAULT_NEXT = "/";

export function safeNext(value: string | string[] | null | undefined, fallback: string = DEFAULT_NEXT): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return fallback;
  let v = raw.trim();
  if (!v || v.length > 2000) return fallback;
  // Reject control characters and backslashes (browsers treat `\` like `/`).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback;
  // Must be a single-slash absolute path: no scheme, no protocol-relative `//host`.
  if (!v.startsWith("/") || v.startsWith("//")) return fallback;
  // Strip a leading base path so we never produce `/admin/admin/...`.
  if (v === "/admin" || v.startsWith("/admin/") || v.startsWith("/admin?") || v.startsWith("/admin#")) {
    v = v.slice("/admin".length) || "/";
    if (!v.startsWith("/")) v = "/" + v;
  }
  // Decode once to catch `/%2F/evil.com` style tricks, then re-check.
  try {
    const decoded = decodeURIComponent(v);
    if (decoded.startsWith("//") || /[\\]/.test(decoded)) return fallback;
  } catch {
    return fallback;
  }
  // Never bounce back to the login page itself.
  if (v === "/login" || v.startsWith("/login?") || v.startsWith("/login/")) return fallback;
  return v;
}

/** `/login?next=<encoded>` for the given app-relative path. */
export function loginUrl(next?: string, extra?: Record<string, string>): string {
  const sp = new URLSearchParams();
  const n = safeNext(next, "");
  if (n && n !== "/") sp.set("next", n);
  for (const [k, val] of Object.entries(extra ?? {})) sp.set(k, val);
  const q = sp.toString();
  return q ? `/login?${q}` : "/login";
}
