-- Supabase Data API lockdown (see packages/db/src/lockdown.ts). No-op unless the anon/authenticated roles exist.
DO $lockdown_rls$
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
$lockdown_rls$;
--> statement-breakpoint
DO $lockdown_grants$
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
$lockdown_grants$;
