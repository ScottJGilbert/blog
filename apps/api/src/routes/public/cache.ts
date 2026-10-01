import type { Response } from "express";

export const PUBLIC_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

/** Shared-cache friendly headers for anonymous public GETs (CDN: 60 s fresh, 5 min stale-while-revalidate). */
export function cachePublic(res: Response): void {
  res.set("cache-control", PUBLIC_CACHE);
}

/** Anything that depends on the cookie (viewer-specific flags, account data) must never be stored by a shared cache. */
export function noStore(res: Response): void {
  res.set("cache-control", "private, no-store");
  res.vary("Cookie");
}
