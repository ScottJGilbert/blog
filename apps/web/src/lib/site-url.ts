import { derivedPublicOrigin } from "@blog/shared/server";
import { SITE_DOMAIN } from "./site";

/**
 * Public origin used for metadataBase / canonical URLs / sitemap / robots / JSON-LD (server-side only).
 * SITE_URL wins. Without it: on Vercel the production domain (production) or the deployment's own URL (previews), derived
 * from Vercel's system env vars; development falls back to localhost; any other production build uses the site's own domain.
 * A production build must never leak `localhost` into canonical URLs, sitemaps or feeds.
 * Statically prerendered pages freeze this value at build time; ISR / dynamic routes (sitemap, posts) evaluate it at runtime.
 */
export function resolveSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const derived = derivedPublicOrigin(env);
  if (derived) return derived;
  if (env.NODE_ENV !== "production") return "http://localhost:3000";
  return `https://${SITE_DOMAIN}`;
}

export const SITE_URL = resolveSiteUrl();
