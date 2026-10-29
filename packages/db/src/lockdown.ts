import { sql } from "drizzle-orm";
import type { DbOrTx } from "./client";

/**
 * Supabase exposes the `public` schema through PostgREST (the "Data API") to the PUBLIC anon key and to every signed-in
 * `authenticated` user, and tables created by SQL migrations have row level security OFF and are granted to those roles by
 * default. Anyone holding the (public) anon key could therefore read `user`, `session`, `account` (password hashes, tokens)...
 * This app talks to Postgres directly as the table owner (`postgres`, which has BYPASSRLS) and never uses the Data API, so we:
 *  1. ENABLE row level security on every table of `public` and `drizzle` (no policies = deny all for anon/authenticated). We do NOT
 *     FORCE it: FORCE applies RLS to the owner too, which would lock out an owner that lacks BYPASSRLS (superusers and BYPASSRLS
 *     roles bypass RLS even when forced, so on Supabase FORCE would add nothing, and elsewhere it would break the app).
 *  2. REVOKE every privilege on tables/sequences/functions of `public` from anon and authenticated (defence in depth: even a
 *     later `CREATE POLICY` or a forgotten ENABLE does not open anything), and ALTER DEFAULT PRIVILEGES so objects created later by
 *     the current role are not granted to them again.
 * Every step is guarded by `pg_roles`: on plain Postgres (no anon/authenticated role) it does nothing at all.
 * Postgres functions keep their default `EXECUTE` for PUBLIC; ours are none, and extension functions are pure math.
 *
 * The same statements are in migration `0003_supabase_lockdown.sql` (a test keeps them identical) and are re-run by `migrate.ts`
 * after every migration run so a table added by a future migration is covered even if its author forgets.
 */
export const LOCKDOWN_STATEMENTS: readonly string[] = [
  `DO $lockdown_rls$
DECLARE
  rel record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) THEN
    RETURN;
  END IF;
  FOR rel IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', rel.schema_name, rel.table_name);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'lockdown: cannot enable row level security on %.% (not the owner)', rel.schema_name, rel.table_name;
    END;
  END LOOP;
END
$lockdown_rls$`,
  `DO $lockdown_grants$
DECLARE
  role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', role_name);
  END LOOP;
END
$lockdown_grants$`,
];

/** `locked`: no anon/authenticated access to any `public` relation; `open`: some relation is reachable; `n/a`: no such roles (not Supabase). */
export type DataApiExposure = "locked" | "open" | "n/a";

/** Relations in `public` that anon/authenticated can touch with no row level security standing in the way. */
const EXPOSURE_QUERY = sql`
  select
    exists (select 1 from pg_roles where rolname in ('anon', 'authenticated')) as has_roles,
    (select count(*)::int
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (not c.relrowsecurity or c.relkind in ('v', 'm', 'f') or exists (select 1 from pg_policy p where p.polrelid = c.oid))
        and exists (
          select 1 from pg_roles r
           where r.rolname in ('anon', 'authenticated')
             and (has_any_column_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') or has_table_privilege(r.rolname, c.oid, 'DELETE,TRUNCATE,TRIGGER'))
        )) as exposed`;

export async function checkDataApiExposure(db: DbOrTx): Promise<DataApiExposure> {
  const { rows } = await db.execute<{ has_roles: boolean; exposed: number }>(EXPOSURE_QUERY);
  const row = rows[0];
  if (!row?.has_roles) return "n/a";
  return row.exposed > 0 ? "open" : "locked";
}

/** Idempotent. Apply the lockdown, then report whether anything is still reachable. */
export async function lockdownExposedSchemas(db: DbOrTx): Promise<DataApiExposure> {
  for (const statement of LOCKDOWN_STATEMENTS) await db.execute(sql.raw(statement));
  return checkDataApiExposure(db);
}
