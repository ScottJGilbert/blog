import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { createDb, describeUrl, isDirectSupabaseHost, isPooledUrl, migrationDatabaseUrls, redactUrl, scrubSecrets, type Database } from "./client";
import { lockdownExposedSchemas, type DataApiExposure } from "./lockdown";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Arbitrary constant: pg advisory lock key so concurrent deploys/test workers don't race migrations. */
const MIGRATION_LOCK_KEY = 0x626c6f67; // "blog"

/**
 * Make sure pgvector exists and return the statements that let migrations resolve its type / operator classes.
 * On Supabase extensions live in the `extensions` schema (created there when it exists, so the Data API never sees the
 * functions in `public`); a connection whose search_path lacks that schema would fail with `type "vector" does not exist`, and a
 * pooled connection cannot `SET` it for the session. `SET LOCAL` inside the migration transaction works everywhere.
 */
async function vectorPreamble(db: Database): Promise<string[]> {
  const find = async () =>
    (await db.execute<{ nspname: string }>(sql`select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`)).rows[0]?.nspname;
  let schema = await find();
  if (!schema) {
    const hasExtensionsSchema = (await db.execute(sql`select 1 from pg_namespace where nspname = 'extensions'`)).rows.length > 0;
    // Failure (no privilege, extension not installed on the server) is reported by migration 0000, which repeats this statement.
    await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS vector${hasExtensionsSchema ? " WITH SCHEMA extensions" : ""}`)).catch(() => undefined);
    schema = await find();
  }
  return schema && schema !== "public" ? [`SET LOCAL search_path TO "public", "${schema.replace(/"/g, '""')}"`] : [];
}

/**
 * Apply all pending migrations (idempotent), then re-run the Data API lockdown (a no-op off Supabase) so a table added by a future
 * migration is covered even if its author forgot. Takes an advisory lock so concurrent runners serialise.
 * The lock is session-level, so it is only taken on a direct / session-pooler connection (a transaction-mode pooler would
 * release it at once or leak it to another client): run migrations with `DATABASE_URL_UNPOOLED`. Nothing else here is
 * session-scoped: drizzle runs all pending migrations in ONE transaction, so a transaction-mode pooler is fine without the lock.
 */
export async function runMigrations(db: Database, migrationsFolder: string = MIGRATIONS_FOLDER, opts: { lock?: boolean } = {}): Promise<DataApiExposure> {
  const apply = async () => {
    const preamble = await vectorPreamble(db);
    const migrations = readMigrationFiles({ migrationsFolder }).map((m) => ({ ...m, sql: [...preamble, ...m.sql] }));
    // `dialect`/`session` are @internal in drizzle's types; this is exactly what drizzle's own `migrate()` calls, minus the preamble.
    const { dialect, session } = db as unknown as { dialect: { migrate(m: unknown, s: unknown, c: unknown): Promise<void> }; session: unknown };
    await dialect.migrate(migrations, session, { migrationsFolder });
    return lockdownExposedSchemas(db);
  };
  if (opts.lock === false) return apply();
  const client = await db.$client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      return await apply();
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export interface MigrateUrlOptions {
  connectionTimeoutMillis?: number;
  log?: (message: string) => void;
}

/** Migrate one database. Throws when anon/authenticated could still reach a `public` relation afterwards. */
export async function migrateUrl(url: string, opts: MigrateUrlOptions = {}): Promise<void> {
  const log = opts.log ?? ((m) => console.log(`[db] ${m}`));
  const handle = createDb(url, { max: 2, connectionTimeoutMillis: opts.connectionTimeoutMillis });
  try {
    const pooled = isPooledUrl(url);
    if (pooled) log("migrating through a transaction-mode pooler without advisory lock; prefer DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING");
    const exposure = await runMigrations(handle.db, MIGRATIONS_FOLDER, { lock: !pooled });
    log(`data API exposure: ${exposure}`);
    if (exposure === "open") {
      throw new Error("anon/authenticated can still reach tables in schema public after the lockdown (a table owned by another role?): fix ownership or run `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` as the owner");
    }
  } finally {
    await handle.close();
  }
}

const UNREACHABLE_CODES = new Set(["ENETUNREACH", "EADDRNOTAVAIL", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"]);

/** The host could not be reached at all (IPv6-only host from an IPv4-only network, DNS, blackholed route). Looks through `AggregateError`s and causes. */
export function isUnreachableError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string" && UNREACHABLE_CODES.has(e.code)) return true;
  if (typeof e.message === "string" && /timeout exceeded when trying to connect/i.test(e.message)) return true;
  const nested = Array.isArray(e.errors) ? e.errors : [];
  return [...nested, e.cause].some((n) => isUnreachableError(n, depth + 1));
}

/** An error's message plus those of its `cause` chain (drizzle wraps driver errors in "Failed query: ..."). */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  for (let cur: unknown = err, i = 0; cur && i < 4; i++) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = (cur as { cause?: unknown }).cause;
  }
  return [...new Set(parts)].join(" <- ");
}

/**
 * Migrate with the first URL that works. The direct host `db.<ref>.supabase.co` is IPv6-only on the free plan, so from an
 * IPv4-only network (Vercel builds) it fails with ENETUNREACH & co: only then fall back to the next URL (the pooler), saying why.
 * Every other failure is final. Errors are rethrown with the URL's password scrubbed. Returns the URL that was used.
 */
export async function migrateFirstReachable(
  urls: string[],
  opts: MigrateUrlOptions & { run?: (url: string) => Promise<void> } = {},
): Promise<string> {
  const log = opts.log ?? ((m) => console.log(`[db] ${m}`));
  const run = opts.run ?? ((url: string) => migrateUrl(url, opts));
  for (const [i, url] of urls.entries()) {
    log(`migrating ${describeUrl(url)}${isPooledUrl(url) ? " (transaction pooler)" : ""}`);
    try {
      await run(url);
      return url;
    } catch (err) {
      const host = describeUrl(url).split(/[:/]/)[0]!;
      if (i < urls.length - 1 && isDirectSupabaseHost(host) && isUnreachableError(err)) {
        log(`${host} is unreachable from here (${scrubSecrets(String((err as { code?: unknown }).code ?? (err as Error).message), url)}): Supabase direct hosts are IPv6-only on the free plan; falling back to ${describeUrl(urls[i + 1]!)}`);
        continue;
      }
      const clean = new Error(scrubSecrets(errorText(err), url));
      clean.name = err instanceof Error ? err.name : "Error";
      throw clean;
    }
  }
  throw new Error("no database URL to migrate");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const urls = migrationDatabaseUrls();
  console.log(`[db] migration targets: ${urls.map(redactUrl).join(", ")}`);
  migrateFirstReachable(urls)
    .then(() => console.log("[db] migrations applied"))
    .catch((err) => {
      console.error("[db] migration failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
