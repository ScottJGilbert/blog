import { SITE_DOMAIN } from "./site";

/**
 * Public origin used for metadataBase / canonical URLs / sitemap / robots / JSON-LD (server-side only).
 * Development falls back to localhost. A PRODUCTION build must never leak `localhost` into canonical URLs, sitemaps or
 * feeds, so without SITE_URL it uses the Vercel production domain when present, else the site's own domain.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return `https://${vercel || SITE_DOMAIN}`;
}

export const SITE_URL = resolveSiteUrl();
