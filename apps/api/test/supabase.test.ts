/** Supabase specifics of the API: env aliasing, the Data API exposure report, pgvector living outside `public`. */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configWarnings, loadConfig, missingConfig } from "../src/config";
import type { Deps } from "../src/deps";
import { isDbUnavailable } from "../src/middleware/error-handler";
import { createAdminStatsService } from "../src/services/admin/stats";
import { buildTestApp, type TestApp } from "./helpers";
import { BASE, daysAgo, ensureAuthor, FakeEmbeddings, insertPost, setEmbedding, topicVector } from "./public/fixtures";

const POOLED = "postgres://postgres.abcdefghij:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x";
const DIRECT = "postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres";
const PROD = { NODE_ENV: "production", BETTER_AUTH_SECRET: "s".repeat(40), SITE_URL: "https://blog.example.org" };

describe("DATABASE_URL aliasing", () => {
  it("falls back to POSTGRES_URL (Vercel's Supabase integration); an explicit DATABASE_URL wins", () => {
    expect(loadConfig({ ...PROD, POSTGRES_URL: POOLED }).databaseUrl).toBe(POOLED);
    expect(loadConfig({ ...PROD, DATABASE_URL: "postgres://a/b", POSTGRES_URL: POOLED }).databaseUrl).toBe("postgres://a/b");
    expect(loadConfig({ ...PROD, DATABASE_URL: "", POSTGRES_URL: POOLED }).databaseUrl).toBe(POOLED);
  });

  it("missingConfig / configWarnings understand the alias and flag IPv6-only direct hosts on Vercel", () => {
    const env = { ...PROD, POSTGRES_URL: POOLED };
    expect(missingConfig(loadConfig(env), env)).not.toContain("DATABASE_URL");
    expect(missingConfig(loadConfig(PROD), PROD)).toContain("DATABASE_URL");
    expect(configWarnings(loadConfig(env), env).join("\n")).not.toMatch(/DATABASE_URL/);
    const vercel = { ...PROD, VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: DIRECT };
    expect(configWarnings(loadConfig(vercel), vercel).join("\n")).toMatch(/Supabase direct host.*IPv6-only.*pooler/);
    const ok = { ...vercel, DATABASE_URL: POOLED };
    expect(configWarnings(loadConfig(ok), ok).join("\n")).not.toMatch(/Supabase direct host/);
  });

  it("IPv6 / network errors from the driver count as 'database unavailable' (503, not 500)", () => {
    for (const code of ["ENETUNREACH", "EADDRNOTAVAIL"]) expect(isDbUnavailable(Object.assign(new Error("connect"), { code }))).toBe(true);
  });
});

describe("GET /admin/system dataApiExposure", () => {
  const svc = (rows: unknown) => createAdminStatsService({ db: { execute: async () => ({ rows: [rows] }) }, mailer: { driver: "memory" }, storage: { driver: "memory" }, embeddings: { enabled: false, model: "m" }, newsletter: { kind: "noop" }, config: { version: "t" } } as unknown as Deps);

  it("reports open / locked / n/a from the database", async () => {
    expect((await svc({ has_roles: true, exposed: 2 }).system()).dataApiExposure).toBe("open");
    expect((await svc({ has_roles: true, exposed: 0 }).system()).dataApiExposure).toBe("locked");
    expect((await svc({ has_roles: false, exposed: 0 }).system()).dataApiExposure).toBe("n/a");
  });

  it("is omitted (not an error) when the check itself fails", async () => {
    const broken = createAdminStatsService({ db: { execute: async () => { throw new Error("boom"); } }, mailer: { driver: "m" }, storage: { driver: "s" }, embeddings: { enabled: false, model: "m" }, newsletter: { kind: "noop" }, config: { version: "t" } } as unknown as Deps);
    const info = await broken.system();
    expect(info.db).toBe("down");
    expect(info.dataApiExposure).toBeUndefined();
  });
});

describe("related posts and hybrid search with pgvector outside `public`", () => {
  let t: TestApp;
  const fake = new FakeEmbeddings();
  beforeAll(async () => {
    t = await buildTestApp({ deps: { now: () => BASE, embeddings: fake } });
    await ensureAuthor(t);
    // What Supabase's dashboard does: the extension lives in `extensions`, which is NOT on this connection's search_path.
    await t.db.$client.query("create schema extensions; alter extension vector set schema extensions;");
    await expect(t.db.$client.query("select '[1]'::vector")).rejects.toThrow(/type "vector" does not exist/);
  });
  afterAll(() => t.close());

  it("still ranks by vector similarity (<=> and ::vector are schema-qualified)", async () => {
    const self = await insertPost(t, { slug: "self", publishedAt: daysAgo(9) });
    const near = await insertPost(t, { slug: "near", publishedAt: daysAgo(8) });
    const far = await insertPost(t, { slug: "far", publishedAt: daysAgo(7) });
    const vecOnly = await insertPost(t, { slug: "vec-only", title: "Totally different words", markdown: "Nothing in common.", publishedAt: daysAgo(3) });
    await setEmbedding(t, self, topicVector({ alpha: 1 }));
    await setEmbedding(t, near, topicVector({ alpha: 1, bravo: 0.1 }));
    await setEmbedding(t, far, topicVector({ charlie: 1 }));
    await setEmbedding(t, vecOnly, topicVector({ alpha: 1, bravo: 0.2 }));
    const related = await request(t.app).get("/api/posts/self/related?limit=2").expect(200);
    expect(related.body.data.map((p: { slug: string }) => p.slug)).toEqual(["near", "vec-only"]);
    const search = await request(t.app).get("/api/search?q=alpha").expect(200);
    expect(search.body.data.map((p: { slug: string }) => p.slug)).toContain("vec-only"); // only the vector side can find it
  });
});
