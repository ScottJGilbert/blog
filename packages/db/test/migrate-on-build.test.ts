import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/client";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate";
import { failureHint, migrateOnBuild, planBuild } from "../src/migrate-on-build";
import { user } from "../src/schema/index";
import { createEmptyDb, queryAs } from "./helpers";

const URL_ENV = { DATABASE_URL: "postgres://u:p@localhost:5432/x" };

describe("planBuild", () => {
  it("never migrates by default, off Vercel previews", () => {
    expect(planBuild({}).migrate).toBe(false);
    expect(planBuild(URL_ENV).migrate).toBe(false);
    expect(planBuild({ ...URL_ENV, VERCEL_ENV: "production" }).migrate).toBe(false);
    expect(planBuild({ ...URL_ENV, VERCEL_ENV: "development" }).migrate).toBe(false);
  });
  it("migrates on previews that have a DB URL (DATABASE_URL or POSTGRES_URL...), unless MIGRATE_ON_BUILD=0", () => {
    expect(planBuild({ ...URL_ENV, VERCEL_ENV: "preview" }).migrate).toBe(true);
    expect(planBuild({ POSTGRES_URL: "postgres://x", VERCEL_ENV: "preview" }).migrate).toBe(true);
    expect(planBuild({ POSTGRES_URL_NON_POOLING: "postgres://x", VERCEL_ENV: "preview" }).migrate).toBe(true);
    expect(planBuild({ VERCEL_ENV: "preview" }).migrate).toBe(false);
    expect(planBuild({ ...URL_ENV, VERCEL_ENV: "preview", MIGRATE_ON_BUILD: "0" }).migrate).toBe(false);
  });
  it("MIGRATE_ON_BUILD=1 opts in anywhere (production, local)", () => {
    expect(planBuild({ MIGRATE_ON_BUILD: "1", VERCEL_ENV: "production" }).migrate).toBe(true);
    expect(planBuild({ MIGRATE_ON_BUILD: "true" }).migrate).toBe(true);
  });
  it("SEED_ON_BUILD needs the opt-in and is ignored in production", () => {
    expect(planBuild({ ...URL_ENV, VERCEL_ENV: "preview" }).seed).toBe(false);
    expect(planBuild({ ...URL_ENV, VERCEL_ENV: "preview", SEED_ON_BUILD: "1" }).seed).toBe(true);
    expect(planBuild({ ...URL_ENV, VERCEL_ENV: "production", SEED_ON_BUILD: "1", MIGRATE_ON_BUILD: "1" }).seed).toBe(false);
  });
});

describe("migrateOnBuild", () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });
  const emptyDb = async () => {
    const e = await createEmptyDb();
    cleanups.push(() => e.drop());
    return e;
  };

  it("does nothing on a plain/local build", async () => {
    const logs: string[] = [];
    expect(await migrateOnBuild({ DATABASE_URL: "postgres://u:p@127.0.0.1:1/nope" }, (m) => logs.push(m))).toBe("skipped");
    expect(logs.join("\n")).toMatch(/skipped \(not a Vercel preview build/);
  });

  it("migrates a preview deployment through the direct URL (POSTGRES_URL_NON_POOLING), with a clear log and no secrets", async () => {
    const e = await emptyDb();
    const logs: string[] = [];
    const url = new URL(e.url);
    url.password = "blog";
    const result = await migrateOnBuild({ VERCEL_ENV: "preview", POSTGRES_URL_NON_POOLING: url.toString(), POSTGRES_URL: "postgres://u:S3cr3tPw@127.0.0.1:1/never-used" }, (m) => logs.push(m));
    expect(result).toBe("done");
    expect(logs.join("\n")).toMatch(/applying migrations \(Vercel preview build\)/);
    expect(logs.join("\n")).toMatch(/migrations applied via localhost|127\.0\.0\.1/);
    expect(logs.join("\n")).not.toMatch(/S3cr3tPw|blog:blog/);
    expect(await queryAs(e.url, null, `select count(*)::int as n from "user"`)).toEqual([{ n: 0 }]);
  });

  it("seeds on request with the SEED_* admin and reader, and never the demo accounts", async () => {
    const e = await emptyDb();
    const logs: string[] = [];
    await migrateOnBuild(
      { VERCEL_ENV: "preview", DATABASE_URL: e.url, SEED_ON_BUILD: "1", SEED_ADMIN_EMAIL: "admin@preview.example.org", SEED_ADMIN_PASSWORD: "a-very-long-preview-password", SEED_READER_EMAIL: "reader@preview.example.org", SEED_READER_PASSWORD: "another-very-long-password" },
      (m) => logs.push(m),
    );
    expect((await queryAs(e.url, null, `select email, role from "user" order by email`))).toEqual([
      { email: "admin@preview.example.org", role: "admin" },
      { email: "reader@preview.example.org", role: "reader" },
    ]);
    expect((await queryAs(e.url, null, `select count(*)::int as n from post where status = 'published'`))[0]!.n).toBeGreaterThan(3);
    expect(logs.join("\n")).not.toContain("a-very-long-preview-password");
  });

  it("does not seed production, and fails the build (readably, without the password) when the database is unreachable", async () => {
    const e = await emptyDb();
    const logs: string[] = [];
    await migrateOnBuild({ MIGRATE_ON_BUILD: "1", VERCEL_ENV: "production", DATABASE_URL: e.url, SEED_ON_BUILD: "1", SEED_ADMIN_EMAIL: "a@b.org", SEED_ADMIN_PASSWORD: "a-very-long-preview-password" }, (m) => logs.push(m));
    expect(logs.join("\n")).toMatch(/never seeding demo content into production/);
    expect(await queryAs(e.url, null, `select count(*)::int as n from "user"`)).toEqual([{ n: 0 }]);

    const err = await migrateOnBuild({ MIGRATE_ON_BUILD: "1", DATABASE_URL: "postgres://postgres.abc:S3cr3tPw@127.0.0.1:1/postgres" }, () => undefined).catch((x: Error) => x);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ECONNREFUSED/);
    expect((err as Error).message).not.toContain("S3cr3tPw");
    await expect(migrateOnBuild({ MIGRATE_ON_BUILD: "1" }, () => undefined)).rejects.toThrow(/none of DATABASE_URL, POSTGRES_URL/);
  });

  it("explains common Supabase failures with the knob to turn", () => {
    expect(failureHint("self-signed certificate in certificate chain")).toMatch(/DATABASE_SSL_CA.*DATABASE_SSL=no-verify/);
    expect(failureHint("Tenant or user not found")).toMatch(/postgres\.<project-ref>/);
    expect(failureHint("password authentication failed for user")).toMatch(/percent-encode/);
    expect(failureHint("connect ECONNREFUSED")).toBeUndefined();
  });
});

describe("migrations are safe behind a transaction-mode pooler", () => {
  it("no session state: no advisory lock, no named statements, no bare SET/LISTEN, one transaction for the DDL", async () => {
    const e = await createEmptyDb();
    const h = createDb(e.url, { max: 1 });
    const seen: string[] = [];
    const orig = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const q = args[0] as string | { text: string; name?: string };
      seen.push(typeof q === "string" ? q : `${q.name ? `NAMED(${q.name}) ` : ""}${q.text}`);
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    try {
      await runMigrations(h.db, MIGRATIONS_FOLDER, { lock: false }); // what migrateUrl does for :6543 URLs
    } finally {
      spy.mockRestore();
    }
    try {
      const sqlText = seen.join("\n");
      expect(seen.length).toBeGreaterThan(20);
      expect(sqlText).not.toMatch(/advisory/i);
      expect(sqlText).not.toMatch(/NAMED\(/);
      expect(sqlText).not.toMatch(/^\s*(listen|prepare|discard|reset)\b/im);
      expect(seen.filter((s) => /^\s*set\s/i.test(s) && !/^\s*set local\b/i.test(s))).toEqual([]);
      expect(seen.filter((s) => /^begin/i.test(s))).toHaveLength(1);
      expect(await h.db.select().from(user)).toEqual([]);
    } finally {
      await h.close();
      await e.drop();
    }
  });
});
