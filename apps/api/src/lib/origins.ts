import { derivedPublicOrigin, onVercel, vercelOrigins } from "@blog/shared/server";

type Env = Record<string, string | undefined>;

export { derivedPublicOrigin, onVercel, vercelOrigins };

/**
 * Every Vercel origin of this project (deployment URL, branch alias, production domain), de-duplicated. Exact `https://host`
 * values from Vercel's system env vars, so a user may open the app through any of them and still sign in (the session
 * cookie is host-only) without opening the door to other `*.vercel.app` projects.
 */
export function vercelTrustedOrigins(env: Env): string[] {
  return [...new Set(Object.values(vercelOrigins(env)).filter((o): o is string => Boolean(o)))];
}

/** Hostnames that only ever appear in documentation / templates (`https://your-domain`, bare `example.com`): misconfigured in production. */
const PLACEHOLDER_HOST = /^(example\.(com|org|net)|(.+\.)?your-?domain(\.[a-z]+)?|domain\.tld|changeme\.[a-z]+)$/i;

export function isPlaceholderUrl(url: string): boolean {
  try {
    return PLACEHOLDER_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
