import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client";
import { checkDataApiExposure, LOCKDOWN_STATEMENTS, lockdownExposedSchemas } from "../src/lockdown";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate";
import { createTestDb, type TestDb } from "../src/testing";
import { createEmptyDb, queryAs } from "./helpers";

/**
 * Simulates Supabase's roles on a throw-away database: `anon` / `authenticated` (what the Data API uses for the public key and for
 * signed-in users) with the default privileges Supabase installs (ALL on every new table of `public`).
 */
const SUPABASE_ROLES_SQL = `
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;`;

let rolesExistedBefore = false;
async function ensureRoles(): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://blog:blog@localhost:5432/postgres" });
  await c.connect();
  try {
    rolesExistedBefore = (await c.query("select 1 from pg_roles where rolname in ('anon','authenticated')")).rowCount! > 0;
    for (const r of ["anon", "authenticated"]) {
      await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin; end if; end $$`);
    }
  } finally {
    await c.end();
  }
}

async function dropRoles(): Promise<void> {
  if (rolesExistedBefore) return;
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://blog:blog@localhost:5432/postgres" });
  await c.connect();
  // best effort: another database may still depend on them (never fail the suite for cleanup)
  await c.query("drop role if exists anon, authenticated").catch(() => undefined);
  await c.end();
}

/** Undo the lockdown (the roles already exist while createTestDb migrates): the state of a database migrated before 0003 existed. */
async function unlock(t: TestDb): Promise<void> {
  await t.pool.query(`${SUPABASE_ROLES_SQL} grant all on all tables in schema public to anon, authenticated;`);
  await t.pool.query(`do $$ declare r record; begin for r in select schemaname, tablename from pg_tables where schemaname in ('public','drizzle') loop execute format('alter table %I.%I disable row level security', r.schemaname, r.tablename); end loop; end $$`);
}

const denied = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "42501" }); // insufficient_privilege

describe("exposure check without Supabase roles", () => {
  it("is n/a when the roles do not exist (fake and, when the cluster has none, real)", async () => {
    const fake = { execute: async () => ({ rows: [{ has_roles: false, exposed: 0 }] }) };
    expect(await checkDataApiExposure(fake as never)).toBe("n/a");
    const real = await createTestDb();
    try {
      const hasRoles = async () => (await real.pool.query("select 1 from pg_roles where rolname in ('anon','authenticated')")).rowCount! > 0;
      const before = await hasRoles();
      const exposure = await checkDataApiExposure(real.db);
      if (!before && !(await hasRoles())) {
        expect(exposure).toBe("n/a");
        // plain Postgres / local: the lockdown is a complete no-op (RLS stays off)
        const { rows } = await real.pool.query(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','drizzle') and c.relkind = 'r' and c.relrowsecurity`);
        expect(rows[0].n).toBe(0);
      }
    } finally {
      await real.close();
    }
  });
});

describe("lockdown on a Supabase-like cluster", () => {
  beforeAll(ensureRoles);
  afterAll(dropRoles);

  it("a database migrated before the lockdown existed: anon reads everything, then cannot read anything; the owner still can", async () => {
    const t: TestDb = await createTestDb();
    try {
      // state of a project whose tables were created by earlier migrations and got Supabase's default grants
      await unlock(t);
      await t.pool.query(`insert into "user" (id, name, email) values ('u1', 'Alice', 'alice@example.com')`);
      await t.pool.query(`insert into account (id, account_id, provider_id, user_id, password) values ('a1', 'u1', 'credential', 'u1', 'scrypt-hash')`);

      expect((await queryAs(t.url, "anon", `select email from "user"`))[0]).toEqual({ email: "alice@example.com" });
      expect((await queryAs(t.url, "authenticated", `select password from account`))[0]).toEqual({ password: "scrypt-hash" });
      expect(await checkDataApiExposure(t.db)).toBe("open");

      expect(await lockdownExposedSchemas(t.db)).toBe("locked");

      for (const role of ["anon", "authenticated"]) {
        await denied(queryAs(t.url, role, `select * from "user"`));
        await denied(queryAs(t.url, role, `select * from account`));
        await denied(queryAs(t.url, role, `insert into tag (slug, name) values ('x', 'x')`));
        await denied(queryAs(t.url, role, `delete from session`));
      }
      expect((await queryAs(t.url, null, `select email from "user"`))[0]).toEqual({ email: "alice@example.com" }); // owner unaffected
      // every table of public and drizzle has RLS on, and it is not FORCEd (a forced owner without BYPASSRLS would be locked out)
      const { rows } = await t.pool.query(`select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','drizzle') and c.relkind = 'r'`);
      expect(rows.length).toBeGreaterThan(15);
      expect(rows.every((r) => r.relrowsecurity === true && r.relforcerowsecurity === false)).toBe(true);
      expect(rows.some((r) => r.nspname === "drizzle")).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("fresh database where the roles and default grants exist BEFORE the migrations: migration 0003 locks it down", async () => {
    const empty = await createEmptyDb();
    const h = createDb(empty.url, { max: 2 });
    try {
      await h.pool.query(SUPABASE_ROLES_SQL);
      await runMigrations(h.db);
      await denied(queryAs(empty.url, "anon", `select * from "user"`));
      await denied(queryAs(empty.url, "authenticated", `select * from post`));
      expect(await checkDataApiExposure(h.db)).toBe("locked");
      expect(await queryAs(empty.url, null, `select count(*)::int as n from "user"`)).toEqual([{ n: 0 }]);
    } finally {
      await h.close();
      await empty.drop();
    }
  });

  it("migration 0003 on its own does the lockdown (the SQL file is the same as LOCKDOWN_STATEMENTS)", async () => {
    const file = readFileSync(path.join(MIGRATIONS_FOLDER, "0003_supabase_lockdown.sql"), "utf8");
    const statements = file.split("--> statement-breakpoint").map((s) => s.replace(/^--.*$/gm, "").trim().replace(/;$/, ""));
    expect(statements).toEqual([...LOCKDOWN_STATEMENTS]);

    const t = await createTestDb();
    try {
      await unlock(t);
      expect(await checkDataApiExposure(t.db)).toBe("open");
      for (const s of statements) await t.pool.query(s);
      expect(await checkDataApiExposure(t.db)).toBe("locked");
      await denied(queryAs(t.url, "anon", `select * from "user"`));
    } finally {
      await t.close();
    }
  });

  it("a table added later is covered by the post-migration step even if its author forgot, and default privileges are revoked", async () => {
    const t = await createTestDb();
    try {
      await t.pool.query(SUPABASE_ROLES_SQL);
      await lockdownExposedSchemas(t.db); // revokes the default privileges
      await t.pool.query(`create table future_table (id int primary key, secret text)`);
      await t.pool.query(`insert into future_table values (1, 'hunter2')`);
      await denied(queryAs(t.url, "anon", `select * from future_table`)); // not granted by default any more
      expect((await t.pool.query(`select relrowsecurity from pg_class where relname = 'future_table'`)).rows[0].relrowsecurity).toBe(false);
      await runMigrations(t.db); // what `pnpm db:migrate` does after the next deploy
      expect((await t.pool.query(`select relrowsecurity from pg_class where relname = 'future_table'`)).rows[0].relrowsecurity).toBe(true);

      // forgotten grants are detected: a table granted to anon without RLS is "open", a granted table with RLS and no policy is not
      await t.pool.query(`alter table future_table disable row level security; grant select on future_table to anon`);
      expect(await checkDataApiExposure(t.db)).toBe("open");
      expect(await lockdownExposedSchemas(t.db)).toBe("locked");
      await denied(queryAs(t.url, "anon", `select * from future_table`));
    } finally {
      await t.close();
    }
  });

  it("views and policies count as exposure", async () => {
    const t = await createTestDb();
    try {
      await t.pool.query(SUPABASE_ROLES_SQL);
      await lockdownExposedSchemas(t.db);
      await t.pool.query(`create view v_users as select id from "user"; grant select on v_users to anon`);
      expect(await checkDataApiExposure(t.db)).toBe("open");
      await t.pool.query(`drop view v_users; grant select on tag to authenticated; create policy p on tag for select to authenticated using (true)`);
      expect(await checkDataApiExposure(t.db)).toBe("open");
      await t.pool.query(`drop policy p on tag; revoke all on tag from authenticated`);
      expect(await checkDataApiExposure(t.db)).toBe("locked");
    } finally {
      await t.close();
    }
  });

  it("the app role keeps working with RLS enabled but not forced: drizzle reads and writes still succeed", async () => {
    const t = await createTestDb();
    try {
      await lockdownExposedSchemas(t.db);
      await t.pool.query(`insert into tag (slug, name) values ('ok', 'OK')`);
      expect((await t.pool.query(`select name from tag`)).rows).toEqual([{ name: "OK" }]);
      await runMigrations(t.db); // idempotent
    } finally {
      await t.close();
    }
  });
});
