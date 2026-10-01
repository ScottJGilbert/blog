/**
 * Test helpers (import from "@blog/db/testing"). Real Postgres, no mocks.
 *
 * `createTestDb()` gives every caller (usually each test file) its OWN throw-away database cloned from the server
 * in TEST_DATABASE_URL (default postgres://blog:blog@localhost:5432/blog_test), migrated and ready. That makes
 * parallel vitest workers and parallel agents safe. Set TEST_DB_SHARED=1 (or `{ isolated: false }`) to use
 * TEST_DATABASE_URL itself instead (migrated, then `truncateAll()` between tests).
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDb, DEFAULT_TEST_DATABASE_URL, type Database, type DbHandle } from "./client";
import { runMigrations } from "./migrate";

export interface TestDb extends DbHandle {
  /** Connection string of the database in use. */
  url: string;
  /** Delete all rows from every application table (keeps schema + migration journal). */
  truncateAll(): Promise<void>;
}

export interface CreateTestDbOptions {
  /** Default true: create a private database. false: use TEST_DATABASE_URL directly. */
  isolated?: boolean;
  /** Base URL (default TEST_DATABASE_URL). */
  url?: string;
}

const PREFIX = "t";
const STALE_MS = 60 * 60 * 1000;

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function quoteIdent(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe database name: ${name}`);
  return `"${name}"`;
}

async function dropStale(admin: pg.Client, baseName: string): Promise<void> {
  const { rows } = await admin.query<{ datname: string }>("select datname from pg_database where datname like $1", [
    `${baseName}\\_${PREFIX}\\_%`,
  ]);
  for (const { datname } of rows) {
    const m = new RegExp(`^${baseName}_${PREFIX}_([0-9a-z]+)_[0-9a-f]+$`).exec(datname);
    if (!m) continue;
    const created = parseInt(m[1]!, 36);
    if (Number.isFinite(created) && Date.now() - created > STALE_MS) {
      await admin.query(`drop database if exists ${quoteIdent(datname)} with (force)`).catch(() => undefined);
    }
  }
}

export async function truncateAll(db: Database): Promise<void> {
  const { rows } = await db.$client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename.replace(/"/g, '""')}"`).join(", ");
  await db.$client.query(`truncate table ${list} restart identity cascade`);
}

export async function createTestDb(options: CreateTestDbOptions = {}): Promise<TestDb> {
  const baseUrl = options.url ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const isolated = options.isolated ?? process.env.TEST_DB_SHARED !== "1";

  if (!isolated) {
    const handle = createDb(baseUrl, { max: 5 });
    await runMigrations(handle.db);
    return { ...handle, url: baseUrl, truncateAll: () => truncateAll(handle.db) };
  }

  const baseName = decodeURIComponent(new URL(baseUrl).pathname.slice(1)) || "blog_test";
  const dbName = `${baseName}_${PREFIX}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const adminUrl = withDatabase(baseUrl, "postgres");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await dropStale(admin, baseName);
    await admin.query(`create database ${quoteIdent(dbName)}`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(baseUrl, dbName);
  const handle = createDb(url, { max: 5 });
  try {
    await runMigrations(handle.db);
  } catch (err) {
    await handle.close();
    throw err;
  }
  let closed = false;
  return {
    ...handle,
    url,
    truncateAll: () => truncateAll(handle.db),
    async close() {
      if (closed) return;
      closed = true;
      await handle.close();
      const a = new pg.Client({ connectionString: adminUrl });
      try {
        await a.connect();
        await a.query(`drop database if exists ${quoteIdent(dbName)} with (force)`);
      } catch {
        /* best effort; stale databases are reaped by later runs */
      } finally {
        await a.end().catch(() => undefined);
      }
    },
  };
}
