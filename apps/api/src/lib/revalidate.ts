import type { Config } from "../config";
import type { Logger } from "../logger";

/** Revalidate cached pages in the web app. Best-effort: never throws, bounded by a short timeout. */
export type Revalidator = (tags: string[]) => Promise<void>;

/**
 * POSTs `{ "tags": [...] }` to `WEB_REVALIDATE_URL` with header `x-revalidate-secret: <REVALIDATE_SECRET>`.
 * Tags used across the platform: `posts`, `post:<slug>`, `section:<section>`, `tags`.
 */
export function createRevalidator(config: Config, logger: Logger, fetchImpl: typeof fetch = fetch): Revalidator {
  return async (tags) => {
    const unique = [...new Set(tags)].filter(Boolean);
    const { url, secret } = config.revalidate;
    if (!url || unique.length === 0) {
      if (!url) logger.debug({ tags: unique }, "web revalidation skipped (WEB_REVALIDATE_URL not set)");
      return;
    }
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { "x-revalidate-secret": secret } : {}) },
        body: JSON.stringify({ tags: unique }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) logger.warn({ status: res.status, tags: unique }, "web revalidation rejected");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), tags: unique }, "web revalidation failed");
    }
  };
}

/** Tags to revalidate for a change to one post. */
export function postTags(post: { slug: string; section: string }, extra: string[] = []): string[] {
  return ["posts", `post:${post.slug}`, `section:${post.section}`, ...extra];
}

/** `revalidateWeb(deps, ["posts", "post:slug"])` — thin alias of `deps.revalidate` (best-effort, never throws). */
export const revalidateWeb = (deps: { revalidate: Revalidator }, tags: string[]): Promise<void> => deps.revalidate(tags);
