/**
 * Server-side helpers for talking to ANOTHER service of this project (web/admin -> API, API -> web) on Vercel Services
 * and locally. Import from `@blog/shared/server` (never from browser code: it reads `process.env`).
 *
 * - `normalizeServiceUrl`: the value of a Vercel Services binding (`API_INTERNAL_URL`, `WEB_INTERNAL_URL`) is "an absolute URL
 *   that may or may not carry a path / trailing slash / scheme". We keep origin + path prefix and drop the rest.
 * - `resolveServiceUrl`: env value -> else this deployment's public URL (`VERCEL_URL`) -> else the local default.
 * - `protectionBypassHeaders`: previews sit behind Vercel Authentication; a server-to-server call to a PUBLIC deployment URL
 *   needs `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET`. Only ever attached for this project's own hosts.
 */
export type Env = Record<string, string | undefined>;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

/** `https://host[/prefix]` without query, hash or trailing slash; `undefined` when `raw` is empty or not an http(s) URL. */
export function normalizeServiceUrl(raw: string | null | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const candidate = SCHEME.test(v) ? v : `${LOCAL_HOST.test(v) ? "http" : "https"}://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(candidate);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) return undefined;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

/** Lower-cased host (no scheme / path) of a Vercel `VERCEL_*URL` value, or undefined when it is not a plain hostname. */
export function vercelHost(raw: string | null | undefined): string | undefined {
  const v = raw?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  return v && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v) ? v : undefined;
}

/** Is this process running on Vercel (any environment)? */
export function onVercel(env: Env): boolean {
  return Boolean(env.VERCEL) || Boolean(env.VERCEL_ENV);
}

export interface VercelOrigins {
  /** `https://<this deployment>.vercel.app` (unique per deployment). */
  deployment?: string;
  /** `https://<project>-git-<branch>-<team>.vercel.app` (stable alias of the branch). */
  branch?: string;
  /** The production domain of the project (custom domain if one is assigned). */
  production?: string;
}

const asOrigin = (raw: string | undefined): string | undefined => {
  const host = vercelHost(raw);
  return host ? `https://${host}` : undefined;
};

/**
 * The public origins of THIS project from Vercel's system env vars: exact `https://host` values (never wildcards, never
 * request headers). Empty off Vercel. None of them is known at build time on every setup: read them at request time where
 * you can.
 */
export function vercelOrigins(env: Env): VercelOrigins {
  if (!onVercel(env)) return {};
  return { deployment: asOrigin(env.VERCEL_URL), branch: asOrigin(env.VERCEL_BRANCH_URL), production: asOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) };
}

/**
 * Public origin to use when no site URL is configured: the production domain in production, this deployment's own URL on
 * previews (so links open the build that produced them); `undefined` off Vercel.
 */
export function derivedPublicOrigin(env: Env): string | undefined {
  const o = vercelOrigins(env);
  if (env.VERCEL_ENV === "production") return o.production ?? o.deployment;
  return o.deployment ?? o.branch ?? o.production;
}

export interface ResolvedServiceUrl {
  url: string;
  /** `env`: the configured / bound value; `deployment`: this deployment's public URL (needs the bypass header); `default`: local dev. */
  source: "env" | "deployment" | "default";
}

export function resolveServiceUrl(raw: string | undefined, env: Env, localDefault: string): ResolvedServiceUrl {
  const fromEnv = normalizeServiceUrl(raw);
  if (fromEnv) return { url: fromEnv, source: "env" };
  const host = env.VERCEL ? vercelHost(env.VERCEL_URL) : undefined;
  if (host) return { url: `https://${host}`, source: "deployment" };
  return { url: localDefault, source: "default" };
}

/** Hosts that belong to THIS project and are protected by Vercel Authentication on previews. */
export function ownPublicHosts(env: Env): string[] {
  const hosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.SITE_URL, env.BETTER_AUTH_URL]
    .map((h) => vercelHost(h))
    .filter((h): h is string => Boolean(h));
  return [...new Set(hosts)];
}

/** `{ "x-vercel-protection-bypass": secret }` when a secret exists AND `targetUrl` is one of this project's public hosts, else `{}`. */
export function protectionBypassHeaders(targetUrl: string, env: Env = process.env): Record<string, string> {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) return {};
  let host: string;
  try {
    host = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return {};
  }
  return ownPublicHosts(env).includes(host) ? { "x-vercel-protection-bypass": secret } : {};
}

/**
 * Marks a call as service-to-service so the API answers it without CDN cache headers (otherwise a revalidated page could be
 * rebuilt from a 60 s old shared-cache copy of the very data that just changed).
 */
export const INTERNAL_REQUEST_HEADER = "x-internal-request";

/** Log a line once per process (module re-evaluation on hot paths / many imports must not spam the runtime logs). */
export function logOnce(key: string, message: string): void {
  const g = globalThis as { __blogLogOnce?: Set<string> };
  const seen = (g.__blogLogOnce ??= new Set());
  if (seen.has(key)) return;
  seen.add(key);
  console.info(message);
}

export interface ServerApiOptions {
  baseUrl: string;
  basePath?: string;
  timeoutMs: number;
  headers: Record<string, string>;
  source: ResolvedServiceUrl["source"];
}

/**
 * Options for `createApiClient` in server code (Server Components, route handlers, `next build`).
 *
 * `API_INTERNAL_URL` wins; on Vercel without it the deployment's public URL is used (with the bypass header);
 * locally `http://localhost:4000`. During `next build` the timeout is short: when no API exists yet the build must degrade
 * quickly instead of hanging for 8 s on every page.
 */
export function serverApiOptions(env: Env = process.env, timeoutMs?: number): ServerApiOptions {
  const { url, source } = resolveServiceUrl(env.API_INTERNAL_URL, env, "http://localhost:4000");
  const building = env.NEXT_PHASE === "phase-production-build";
  logOnce(`api-url:${building ? "build" : "run"}`, `[api-client] API target ${new URL(url).origin} (source: ${source}${building ? ", build phase" : ""})`);
  return {
    baseUrl: url,
    basePath: env.API_BASE_PATH,
    timeoutMs: timeoutMs ?? (building ? 2_500 : 8_000),
    headers: { [INTERNAL_REQUEST_HEADER]: "1", ...protectionBypassHeaders(url, env) },
    source,
  };
}
