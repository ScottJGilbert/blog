import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export const DEFAULT_DATABASE_URL = "postgres://blog:blog@localhost:5432/blog";
export const DEFAULT_TEST_DATABASE_URL = "postgres://blog:blog@localhost:5432/blog_test";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema> & { $client: pg.Pool };
/** Either the database or a transaction handle (what repositories/services should accept). */
export type DbOrTx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute" | "transaction" | "query">;

export interface CreateDbOptions {
  /** Max pool size. Default: env DATABASE_POOL_MAX, else 10 (5 on Vercel, where each lambda has its own pool). */
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  /** Override SSL detection. Default: on when the URL has `sslmode=require|verify-*` / `ssl=true` or host is *.neon.tech. */
  ssl?: boolean;
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

function wantsSsl(url: string): boolean {
  try {
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode");
    if (mode && mode !== "disable" && mode !== "allow" && mode !== "prefer") return true;
    if (u.searchParams.get("ssl") === "true") return true;
    return u.hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

/**
 * Create a drizzle instance on a plain `pg` Pool. Works with Neon's pooled (PgBouncer) connection string:
 * no session-level state is used and prepared statements are not named, so transaction pooling is fine.
 */
export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, options: CreateDbOptions = {}): DbHandle {
  const onVercel = Boolean(process.env.VERCEL);
  const envMax = Number(process.env.DATABASE_POOL_MAX);
  const max = options.max ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : onVercel ? 5 : 10);
  const ssl = options.ssl ?? wantsSsl(url);

  // Strip sslmode from the string when we pass `ssl` ourselves so pg's own (stricter, noisy) parsing doesn't override it.
  let connectionString = url;
  if (ssl) {
    try {
      const u = new URL(url);
      u.searchParams.delete("sslmode");
      u.searchParams.delete("ssl");
      connectionString = u.toString();
    } catch {
      /* keep as is */
    }
  }

  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 10_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    allowExitOnIdle: true,
    application_name: options.applicationName ?? "blog",
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
  });
  // An idle client erroring (e.g. server restart) must not crash the process.
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
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

/** Process-wide singleton (survives hot reload). Uses DATABASE_URL. */
export function getDb(): Database {
  return getDbHandle().db;
}

export function getDbHandle(): DbHandle {
  const g = globalThis as GlobalWithDb;
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
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
