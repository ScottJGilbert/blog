import type { Config } from "../config";
import type { Logger } from "../logger";

/** `x-vercel-protection-bypass` only for this project's own public hosts (never leak the secret to anyone else). */
export function bypassHeaders(config: Pick<Config, "bypassSecret" | "publicHosts">, url: string): Record<string, string> {
  try {
    return config.bypassSecret && config.publicHosts.includes(new URL(url).hostname.toLowerCase()) ? { "x-vercel-protection-bypass": config.bypassSecret } : {};
  } catch {
    return {};
  }
}

/** Revalidate cached pages in the web app. Best-effort: never throws, bounded by a short timeout. */
export type Revalidator = (tags: string[]) => Promise<void>;

/**
 * POSTs `{ "tags": [...] }` to `WEB_REVALIDATE_URL` with header `x-revalidate-secret: <REVALIDATE_SECRET>`.
 * Tags used across the platform: `posts`, `post:<slug>`, `section:<section>`, `tags`.
 */
export function createRevalidator(config: Config, logger: Logger, fetchImpl: typeof fetch = fetch): Revalidator {
  const target = config.revalidate.url;
  // Where invalidations go, logged once per instance (host only: the path and secret are not interesting).
  if (target && !config.isTest) {
    try {
      logger.info({ host: new URL(target).host, source: config.revalidate.source }, "web revalidation target");
    } catch {
      logger.warn("WEB_REVALIDATE_URL is not a valid URL: web revalidation is disabled");
    }
  }
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
        headers: {
          "content-type": "application/json",
          ...(secret ? { "x-revalidate-secret": secret } : {}),
          // previews are behind Vercel Authentication: a call to this project's own public URL needs the bypass secret
          ...bypassHeaders(config, url),
        },
        body: JSON.stringify({ tags: unique }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        const hint = res.status === 401 && res.headers.get("content-type")?.includes("html") ? "Vercel Authentication answered (set VERCEL_AUTOMATION_BYPASS_SECRET)" : undefined;
        logger.warn({ status: res.status, tags: unique, ...(hint ? { hint } : {}) }, "web revalidation rejected");
      }
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
