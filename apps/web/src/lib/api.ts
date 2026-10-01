/**
 * Server-side data layer. Every public page reads through these helpers.
 *
 * Caching (Next "previous model": no cacheComponents):
 *  - each read is a `fetch` carrying cache tags (`posts`, `post:<slug>`, `section:<section>`, `tags`; set by
 *    @blog/shared/client) so the API can expire pages on publish via POST /internal/revalidate, plus a time-based
 *    `revalidate` fallback so a missed webhook heals itself;
 *  - when the API is unreachable at BUILD time the route opts out of prerendering (`connection()`), so
 *    `next build` never fails because the API is down; at RUNTIME the error propagates to the nearest error boundary
 *    (and ISR keeps serving the last good page).
 */
import { cache } from "react";
import { connection } from "next/server";
import {
  ApiError,
  createApiClient,
  isApiError,
  type ListPostsQueryInput,
  type PostDetail,
  type SearchQueryInput,
} from "@blog/shared/client";

export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export const api = createApiClient({
  baseUrl: API_INTERNAL_URL,
  basePath: process.env.API_BASE_PATH ?? "/api",
  timeoutMs: 8_000,
});

/** Seconds. Short enough to self-heal, long enough to shield the API. */
export const REVALIDATE = { list: 300, post: 600, taxonomy: 600, sitemap: 600 } as const;

const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

function isOutage(err: unknown): boolean {
  return isApiError(err) && (err.code === "network_error" || err.code === "timeout" || err.status >= 500);
}

/** Run a data read; on an API outage during `next build`, render this route at request time instead. */
export async function guarded<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (isBuildPhase() && isOutage(err)) await connection();
    throw err;
  }
}

/** Like `guarded`, but 404s from the API resolve to `null` (callers then call `notFound()`). */
export async function guardedOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await guarded(read);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export const LISTING_PAGE_SIZE = 9;

export const getPosts = cache((query: ListPostsQueryInput) =>
  guarded(() => api.publicPosts(query, { next: { revalidate: REVALIDATE.list } })),
);

export const getPost = cache((slug: string): Promise<PostDetail | null> =>
  guardedOrNull(() => api.post(slug, { next: { revalidate: REVALIDATE.post } })),
);

export const getRelated = cache(async (slug: string, limit = 3) => {
  try {
    return await guarded(() => api.related(slug, { limit }, { next: { revalidate: REVALIDATE.post } }));
  } catch {
    return []; // related posts are an enhancement: never fail the post page for them
  }
});

export const getTags = cache(() => guarded(() => api.tags({ next: { revalidate: REVALIDATE.taxonomy } })));

export const getSitemap = cache(() => guarded(() => api.sitemap({ next: { revalidate: REVALIDATE.sitemap } })));

/** Search is never cached: the query space is unbounded. */
export const searchPosts = (query: SearchQueryInput) => guarded(() => api.search(query, { cache: "no-store" }));

export { ApiError, isApiError };
