/** Must match `basePath` in next.config.ts. `Link`, `router` and `redirect()` add it automatically; plain `<a>` / `fetch` do not. */
export const BASE_PATH = "/admin";

export function withBase(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Origin of the public site for preview links ("" = same origin). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

export function publicPostUrl(section: string, slug: string): string {
  return `${SITE_URL}/${section}/${slug}`;
}
