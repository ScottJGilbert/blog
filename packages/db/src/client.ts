import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { ConnectionOptions } from "node:tls";
import * as schema from "./schema/index";

export const DEFAULT_DATABASE_URL = "postgres://blog:blog@localhost:5432/blog";
export const DEFAULT_TEST_DATABASE_URL = "postgres://blog:blog@localhost:5432/blog_test";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema> & { $client: pg.Pool };
/** Either the database or a transaction handle (what repositories/services should accept). */
export type DbOrTx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute" | "transaction" | "query">;

export interface CreateDbOptions {
  /** Max pool size. Default: env DATABASE_POOL_MAX, else 10 (3 on Vercel, where every instance has its own pool). */
  max?: number;
  /** Default 10 s (5 s on Vercel) so idle connections do not pile up on a small managed-Postgres connection budget. */
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  /** Override TLS detection (see `resolveSsl`). `true` = whatever the URL/env imply, defaulting to strict verification. */
  ssl?: boolean | ConnectionOptions;
  /** Log drizzle queries. */
  logger?: boolean;
  applicationName?: string;
}

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  /** Ends the pool. Safe to call multiple times. */
  close(): Promise<void>;
}

type Env = Record<string, string | undefined>;
const nonEmpty = (...values: (string | undefined)[]): string | undefined => values.map((v) => v?.trim()).find(Boolean);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Supabase-managed hosts: `*.pooler.supabase.com` (Supavisor) and `db.<ref>.supabase.co` (direct). */
export function isSupabaseHost(hostname: string): boolean {
  return /(^|\.)supabase\.(com|co)$/i.test(hostname);
}

/** `db.<ref>.supabase.co`: IPv6-only on the free plan, so unreachable from Vercel (IPv4-only egress) and many CI networks. */
export function isDirectSupabaseHost(hostname: string): boolean {
  return /^db\.[a-z0-9]+\.supabase\.co$/i.test(hostname);
}

/** The Vercel integration can prefix every variable (e.g. `SUPABASE_STORAGE_POSTGRES_URL`): take the first matching key. */
function prefixed(env: Env, re: RegExp): string | undefined {
  const key = Object.keys(env).sort().find((k) => re.test(k) && env[k]);
  return key ? env[key] : undefined;
}

/**
 * Runtime URL: `DATABASE_URL`, else the `POSTGRES_URL` that Vercel's Supabase integration injects (Supavisor transaction pooler,
 * port 6543). `undefined` when neither is set.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  return nonEmpty(env.DATABASE_URL, env.POSTGRES_URL, prefixed(env, /^[A-Z0-9]+(_[A-Z0-9]+)*_POSTGRES_URL$/));
}

/** Direct / session-mode URL: `DATABASE_URL_UNPOOLED`, else the integration's `POSTGRES_URL_NON_POOLING`. */
export function resolveUnpooledUrl(env: Env = process.env): string | undefined {
  return nonEmpty(env.DATABASE_URL_UNPOOLED, env.POSTGRES_URL_NON_POOLING, prefixed(env, /^[A-Z0-9]+(_[A-Z0-9]+)*_POSTGRES_URL_NON_POOLING$/));
}

/**
 * True when the endpoint is a transaction-mode pooler, i.e. no session state survives between statements: Supabase Supavisor
 * / PgBouncer on port 6543, a `-pooler` host, or an explicit `pgbouncer=true`. (Supabase's session pooler on 5432 is NOT pooled
 * in this sense: session advisory locks work there.)
 */
export function isPooledUrl(url: string): boolean {
  const u = parse(url);
  if (!u) return false;
  return u.hostname.includes("-pooler") || u.searchParams.get("pgbouncer") === "true" || (isSupabaseHost(u.hostname) && u.port === "6543");
}

/** Any Supabase pooler host (transaction or session mode). Startup parameters beyond user/database are not relied upon there. */
function isSupabasePooler(url: string): boolean {
  const u = parse(url);
  return Boolean(u && /\.pooler\.supabase\.com$/i.test(u.hostname));
}

/**
 * Candidate URLs for migrations, best first: the direct/session URL (session advisory lock, no pooler quirks), then the
 * runtime URL (used as the fallback when the direct host is IPv6-only and unreachable). Falls back to the local default.
 */
export function migrationDatabaseUrls(env: Env = process.env): string[] {
  const urls = [...new Set([resolveUnpooledUrl(env), resolveDatabaseUrl(env)].filter((v): v is string => Boolean(v)))];
  return urls.length ? urls : [DEFAULT_DATABASE_URL];
}

/** The URL schema migrations should use (first of `migrationDatabaseUrls`). */
export function migrationDatabaseUrl(env: Env = process.env): string {
  return migrationDatabaseUrls(env)[0]!;
}

/** `scheme://***@host/db?...`: safe to log even when the password contains a raw `@`, `/` or `#`. */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/).*@/i, "$1***@");
}

/** `host:port/db` of a URL (no credentials, no query) for log lines. */
export function describeUrl(url: string): string {
  const u = parse(url);
  return u ? `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}` : "<unparseable url>";
}

/** Replace the URL's password (raw and percent-decoded) in free text, e.g. a driver error message. */
export function scrubSecrets(text: string, url: string): string {
  const u = parse(url);
  let out = text;
  for (const secret of u ? [u.password, safeDecode(u.password)] : []) if (secret) out = out.split(secret).join("***");
  return out.split(url).join(redactUrl(url));
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** PEM, or base64 of a PEM (what you can paste into a single-line env var). `\n` escapes are accepted. */
export function parseCa(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const pem = raw.includes("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  if (!pem.includes("-----BEGIN")) throw new Error("DATABASE_SSL_CA is neither a PEM certificate nor a base64-encoded PEM");
  return pem.replace(/\\n/g, "\n").trim();
}

let warnedUnverified = false;

/**
 * TLS settings for a URL. `DATABASE_SSL=no-verify` (explicit escape hatch: encrypted, server identity not checked) and
 * `DATABASE_SSL_CA` (PEM or base64 PEM, proper verification) refine the URL's own `sslmode`.
 *
 * Supabase certificates chain to a Supabase CA that is not in Node's trust store, so strict verification fails with
 * "self-signed certificate in certificate chain". For `*.supabase.com` / `*.supabase.co` hosts WITHOUT a CA we therefore default to
 * TLS with `rejectUnauthorized: false`: traffic is encrypted but a man-in-the-middle is not detected. Supply the CA
 * (Supabase dashboard → Database → Settings → SSL Configuration → download certificate) to get full verification.
 * Other hosts are never downgraded: `sslmode=require` means strict verification against the system CAs.
 * With a CA, hostname checking stays on; `DATABASE_SSL=verify-ca` (or `sslmode=verify-ca`) checks the chain only, in case the
 * pooler presents a certificate whose name does not match the pooler host (unverified against a real project).
 */
export function resolveSsl(url: string, env: Env = process.env, warn: (message: string) => void = defaultWarn): false | ConnectionOptions {
  const u = parse(url);
  if (!u) return false;
  const override = env.DATABASE_SSL?.trim().toLowerCase();
  const mode = u.searchParams.get("sslmode")?.toLowerCase();
  const supabase = isSupabaseHost(u.hostname);
  const noVerify = override === "no-verify";
  const tls = noVerify || (mode ? !["disable", "allow", "prefer"].includes(mode) : false) || u.searchParams.get("ssl") === "true" || (supabase && mode !== "disable");
  if (!tls) return false;
  if (noVerify) return { rejectUnauthorized: false };
  const ca = parseCa(env.DATABASE_SSL_CA);
  if (ca) return { ca, rejectUnauthorized: true, ...(override === "verify-ca" || mode === "verify-ca" ? { checkServerIdentity: () => undefined } : {}) };
  // Pooler hosts present *.pooler.supabase.com certificates chained to the bundled root: verify properly.
  if (supabase && /\.pooler\.supabase\.com$/i.test(u.hostname)) return { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true };
  if (supabase) {
    warn("database TLS: Supabase host without DATABASE_SSL_CA, connection is encrypted but the server certificate is NOT verified (set DATABASE_SSL_CA to verify)");
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

function defaultWarn(message: string): void {
  if (warnedUnverified) return;
  warnedUnverified = true;
  console.warn(JSON.stringify({ level: 40, msg: message }));
}

/**
 * Parameters that are not libpq/pg options and must not reach `pg`: Supabase's `supa=base-pooler.x`, Prisma/PgBouncer hints
 * (`pgbouncer`, `connection_limit`, `pool_timeout`, `statement_cache_size`, `schema`) and the TLS flags `resolveSsl` already consumed.
 */
const STRIPPED_PARAMS = ["supa", "pgbouncer", "connection_limit", "pool_timeout", "statement_cache_size", "schema", "sslmode", "ssl"];

/** The URL handed to `pg`: unknown/consumed query parameters removed, everything else (credentials included) untouched. */
export function cleanConnectionString(url: string): string {
  const u = parse(url);
  if (!u) return url;
  for (const p of STRIPPED_PARAMS) u.searchParams.delete(p);
  return u.toString();
}

/**
 * Create a drizzle instance on a plain `pg` Pool. Works behind a transaction-mode pooler (Supabase Supavisor on :6543, PgBouncer):
 * no session-level state is used and prepared statements are not named (drizzle only names them for an explicit `.prepare(name)`,
 * which this codebase never calls), so transaction pooling is fine.
 * Never add `SET ...`, `LISTEN`, session advisory locks or startup `options` (e.g. `statement_timeout`) here: the pooler rejects
 * or silently mis-routes them. Per-statement limits belong inside a transaction (`SET LOCAL`).
 */
export function createDb(url: string = resolveDatabaseUrl() ?? DEFAULT_DATABASE_URL, options: CreateDbOptions = {}): DbHandle {
  const onVercel = Boolean(process.env.VERCEL);
  const envMax = Number(process.env.DATABASE_POOL_MAX);
  const max = options.max ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : onVercel ? 3 : 10);
  const resolved = resolveSsl(url);
  const ssl = options.ssl === undefined ? resolved : options.ssl === true ? resolved || { rejectUnauthorized: true } : options.ssl;

  const pool = new pg.Pool({
    connectionString: cleanConnectionString(url),
    max,
    idleTimeoutMillis: options.idleTimeoutMillis ?? (onVercel ? 5_000 : 10_000),
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    allowExitOnIdle: true,
    // Poolers reject or ignore startup parameters they do not track: skip the optional one there.
    ...(isPooledUrl(url) || isSupabasePooler(url) ? {} : { application_name: options.applicationName ?? "blog" }),
    ssl: ssl || undefined,
  });
  // An idle client erroring (e.g. server restart) must not crash the process.
  pool.on("error", (err) => {
    console.error(JSON.stringify({ level: 50, msg: "database idle client error", err: scrubSecrets(err.message, url) }));
  });

  const db = drizzle(pool, { schema, logger: options.logger ?? false }) as Database;
  let closed = false;
  return {
    db,
    pool,
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}

const globalKey = Symbol.for("@blog/db.singleton");
type GlobalWithDb = typeof globalThis & { [globalKey]?: DbHandle & { url: string } };

/** Process-wide singleton (survives hot reload). Uses DATABASE_URL (else POSTGRES_URL). */
export function getDb(): Database {
  return getDbHandle().db;
}

export function getDbHandle(): DbHandle {
  const g = globalThis as GlobalWithDb;
  const url = resolveDatabaseUrl() ?? DEFAULT_DATABASE_URL;
  const existing = g[globalKey];
  if (existing && existing.url === url) return existing;
  const handle = { ...createDb(url), url };
  g[globalKey] = handle;
  return handle;
}

/** Close the singleton (scripts / graceful shutdown). */
export async function closeDb(): Promise<void> {
  const g = globalThis as GlobalWithDb;
  const existing = g[globalKey];
  if (existing) {
    delete g[globalKey];
    await existing.close();
  }
}
