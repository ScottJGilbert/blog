import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, DEFAULT_DATABASE_URL, type Database } from "./client";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Arbitrary constant: pg advisory lock key so concurrent deploys/test workers don't race migrations. */
const MIGRATION_LOCK_KEY = 0x626c6f67; // "blog"

/** Apply all pending migrations (idempotent). Takes an advisory lock so concurrent runners serialise. */
export async function runMigrations(db: Database, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void> {
  const client = await db.$client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await drizzleMigrate(db, { migrationsFolder });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function migrateUrl(url: string): Promise<void> {
  const handle = createDb(url, { max: 2 });
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const shown = url.replace(/:\/\/[^@]*@/, "://***@");
  console.log(`[db] migrating ${shown}`);
  migrateUrl(url)
    .then(() => {
      console.log("[db] migrations applied");
    })
    .catch((err) => {
      console.error("[db] migration failed:", err);
      process.exitCode = 1;
    });
}
