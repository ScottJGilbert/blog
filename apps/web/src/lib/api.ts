/**
 * Server-side data layer. Every public page reads through these helpers.
 *
 * Caching (Next "previous model": no cacheComponents):
 *  - each read is a `fetch` carrying cache tags (`posts`, `post:<slug>`, `section:<section>`, `tags`; set by
 *    @blog/shared/client) so the API can expire pages on publish via POST /internal/revalidate, plus a time-based
 *    `revalidate` fallback so a missed webhook heals itself;
 *  - when the API is unreachable (or answers anything unusable) at BUILD time the route opts out of prerendering
 *    (`connection()`), so `next build` never fails or stalls because the API is down; at RUNTIME the error propagates to
 *    the nearest error boundary (and ISR keeps serving the last good page).
 */
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import {
  ApiError,
  createApiClient,
  isApiError,
  type ListPostsQueryInput,
  type PostDetail,
  type SearchQueryInput,
} from "@blog/shared/client";
import { serverApiOptions } from "@blog/shared/server";

/**
 * Server-side API client. Target: the `API_INTERNAL_URL` binding (any URL shape, see `normalizeServiceUrl`), else this
 * deployment's public URL on Vercel (with the Authentication-bypass header), else localhost. 8 s per request at runtime,
 * 2.5 s during `next build` so a missing API degrades quickly.
 */
const target = serverApiOptions();
export const API_INTERNAL_URL = target.baseUrl;
/** Headers every server-to-API request carries (internal marker, Authentication bypass); for code that calls `fetch` itself. */
export const API_REQUEST_HEADERS = target.headers;

export const api = createApiClient({
  baseUrl: target.baseUrl,
  basePath: target.basePath,
  timeoutMs: target.timeoutMs,
  headers: target.headers,
});

/** Seconds. Short enough to self-heal, long enough to shield the API. */
export const REVALIDATE = { list: 300, post: 600, taxonomy: 600, sitemap: 600 } as const;

export const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

/**
 * During `next build` on a fresh deployment the API service does not exist yet (or answers with a login page / 404 / 5xx).
 * The first failure flips this flag for the rest of the build worker, so the remaining pages skip the network entirely
 * instead of waiting on a timeout each. Nothing from a failed read is ever baked into the build: the route is rendered per
 * request instead (`connection()`), and the data cache fills at runtime.
 */
let buildOutage = false;
export const apiDownAtBuild = () => isBuildPhase() && buildOutage;
export function noteBuildOutage(): void {
  if (isBuildPhase()) buildOutage = true;
}

/** Run a data read; on ANY API failure during `next build`, render this route at request time instead of failing the build. */
export async function guarded<T>(read: () => Promise<T>, opts: { allow404?: boolean } = {}): Promise<T> {
  if (apiDownAtBuild()) await connection();
  try {
    return await read();
  } catch (err) {
    if (isBuildPhase() && !(opts.allow404 && isApiError(err) && err.status === 404)) {
      noteBuildOutage();
      await connection();
    }
    throw err;
  }
}

/** Like `guarded`, but 404s from the API resolve to `null` (callers then call `notFound()`). */
export async function guardedOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await guarded(read, { allow404: true });
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
  } catch (err) {
    unstable_rethrow(err); // `connection()` at build time must reach Next, everything else degrades
    return []; // related posts are an enhancement: never fail the post page for them
  }
});

export const getTags = cache(() => guarded(() => api.tags({ next: { revalidate: REVALIDATE.taxonomy } })));

export const getSitemap = cache(() => guarded(() => api.sitemap({ next: { revalidate: REVALIDATE.sitemap } })));

/** Search is never cached: the query space is unbounded. */
export const searchPosts = (query: SearchQueryInput) => guarded(() => api.search(query, { cache: "no-store" }));

export { ApiError, isApiError };
