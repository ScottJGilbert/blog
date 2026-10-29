import { verifyPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { account, post, user } from "../src/schema/index";
import { DEMO_ADMIN, DEMO_READER, seed, seedAccountsFromEnv, seedDeployment } from "../src/seed";
import { SEED_POSTS } from "../src/seed-content";
import { createTestDb, type TestDb } from "../src/testing";

const STRONG = "correct-horse-battery-staple";
const ENV = { VERCEL_ENV: "preview", SEED_ADMIN_EMAIL: "Boss@Example.org", SEED_ADMIN_PASSWORD: STRONG, SEED_READER_EMAIL: "reader@e2e.example.org", SEED_READER_PASSWORD: "another-long-password-1" };

describe("seedAccountsFromEnv", () => {
  it("accepts a strong admin and reader (emails lowercased)", () => {
    const { accounts, problems } = seedAccountsFromEnv(ENV);
    expect(problems).toEqual([]);
    expect(accounts.admin).toMatchObject({ email: "boss@example.org", password: STRONG });
    expect(accounts.reader).toMatchObject({ email: "reader@e2e.example.org" });
  });

  it("refuses missing, short, default and placeholder passwords, bad emails and a shared address, without echoing values", () => {
    expect(seedAccountsFromEnv({}).accounts).toEqual({});
    expect(seedAccountsFromEnv({}).problems[0]).toMatch(/SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are not set/);
    const cases: [Record<string, string>, RegExp][] = [
      [{ SEED_ADMIN_EMAIL: "a@b.org" }, /SEED_ADMIN_PASSWORD must be at least 16/],
      [{ SEED_ADMIN_PASSWORD: STRONG }, /SEED_ADMIN_EMAIL is missing/],
      [{ SEED_ADMIN_EMAIL: "a@b.org", SEED_ADMIN_PASSWORD: "short-password" }, /at least 16/],
      [{ SEED_ADMIN_EMAIL: "a@b.org", SEED_ADMIN_PASSWORD: "admin-password-123" }, /at least 16|known default/],
      [{ SEED_ADMIN_EMAIL: "a@b.org", SEED_ADMIN_PASSWORD: "changeme-changeme-changeme" }, /known default/],
      [{ SEED_ADMIN_EMAIL: "not-an-email", SEED_ADMIN_PASSWORD: STRONG }, /SEED_ADMIN_EMAIL is missing or not an email/],
    ];
    for (const [env, re] of cases) {
      const r = seedAccountsFromEnv(env);
      expect(r.accounts.admin).toBeUndefined();
      expect(r.problems.join("\n")).toMatch(re);
      expect(r.problems.join("\n")).not.toContain(STRONG);
    }
    expect(seedAccountsFromEnv({ SEED_ADMIN_EMAIL: "a@b.org", SEED_ADMIN_PASSWORD: STRONG, SEED_READER_EMAIL: "a@b.org", SEED_READER_PASSWORD: STRONG + "2" }).accounts.reader).toBeUndefined();
    // the public demo passwords are long enough, so only the explicit default check rejects them
    for (const pw of [DEMO_ADMIN.password, DEMO_READER.password]) {
      expect(seedAccountsFromEnv({ SEED_ADMIN_EMAIL: "a@b.org", SEED_ADMIN_PASSWORD: pw }).problems.join()).toMatch(/known default/);
    }
  });
});

describe("deployment seed (SEED_ON_BUILD)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  const log: string[] = [];
  const emailsOf = async () => (await t.db.select({ email: user.email }).from(user)).map((u) => u.email).sort();
  const hashOf = async (email: string) => {
    const [row] = await t.db.select({ pw: account.password }).from(account).innerJoin(user, eq(user.id, account.userId)).where(and(eq(user.email, email), eq(account.providerId, "credential")));
    return row?.pw ?? "";
  };

  it("creates the configured admin + verified reader, tags and posts, and NEVER the public demo accounts", async () => {
    const r = await seedDeployment(t.db, ENV, (m) => log.push(m));
    expect(r.users).toBe(2);
    expect(r.posts).toBe(SEED_POSTS.length);
    expect(await emailsOf()).toEqual(["boss@example.org", "reader@e2e.example.org"]);
    const [admin] = await t.db.select().from(user).where(eq(user.email, "boss@example.org"));
    const [reader] = await t.db.select().from(user).where(eq(user.email, "reader@e2e.example.org"));
    expect(admin).toMatchObject({ role: "admin", emailVerified: true });
    expect(reader).toMatchObject({ role: "reader", emailVerified: true, banned: false });
    expect(await verifyPassword({ hash: await hashOf("boss@example.org"), password: STRONG })).toBe(true);
    const authors = await t.db.selectDistinct({ id: post.authorId }).from(post);
    expect(authors).toEqual([{ id: admin!.id }]);
    expect(log.join("\n")).not.toContain(STRONG);
    expect(log.join("\n")).not.toContain("boss@example.org"); // masked
  });

  it("is idempotent, keeps existing passwords and edited posts, and resets passwords only on request", async () => {
    const before = await hashOf("boss@example.org");
    await t.db.update(post).set({ title: "Edited on the preview" }).where(eq(post.slug, SEED_POSTS[0]!.slug));
    const again = await seedDeployment(t.db, { ...ENV, SEED_ADMIN_PASSWORD: "a-different-long-password" }, () => undefined);
    expect(again.posts).toBe(0); // existing posts are left alone
    expect(await hashOf("boss@example.org")).toBe(before);
    expect((await t.db.select({ title: post.title }).from(post).where(eq(post.slug, SEED_POSTS[0]!.slug)))[0]!.title).toBe("Edited on the preview");
    expect(await emailsOf()).toHaveLength(2);

    await seedDeployment(t.db, { ...ENV, SEED_ADMIN_PASSWORD: "a-different-long-password", SEED_RESET_PASSWORDS: "1" }, () => undefined);
    expect(await verifyPassword({ hash: await hashOf("boss@example.org"), password: "a-different-long-password" })).toBe(true);
    expect(await verifyPassword({ hash: await hashOf("boss@example.org"), password: STRONG })).toBe(false);
  });

  it("does not demote or un-ban an existing reader account", async () => {
    await t.db.update(user).set({ banned: true, role: "admin" }).where(eq(user.email, "reader@e2e.example.org"));
    await seedDeployment(t.db, ENV, () => undefined);
    const [reader] = await t.db.select().from(user).where(eq(user.email, "reader@e2e.example.org"));
    expect(reader).toMatchObject({ banned: true, role: "admin" });
  });

  it("without usable SEED_* it logs loudly, creates no accounts, and still seeds tags", async () => {
    const t2 = await createTestDb();
    try {
      const logs: string[] = [];
      const r = await seedDeployment(t2.db, { VERCEL_ENV: "preview", SEED_ADMIN_EMAIL: "x@y.org", SEED_ADMIN_PASSWORD: "admin-password-123" }, (m) => logs.push(m));
      expect(r).toMatchObject({ users: 0, posts: 0 });
      expect(r.tags).toBeGreaterThan(0);
      expect(logs.join("\n")).toMatch(/WARNING SEED_ADMIN_PASSWORD/);
      expect((await t2.db.select({ n: sql<number>`count(*)::int` }).from(user))[0]!.n).toBe(0);
    } finally {
      await t2.close();
    }
  });

  it("seed() refuses the public demo accounts on Vercel even when asked for them; local dev keeps the old behaviour", async () => {
    const t2 = await createTestDb();
    try {
      for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }, { VERCEL: "1" }]) {
        const logs: string[] = [];
        const r = await seed(t2.db, { demoData: true, env, log: (m) => logs.push(m) });
        expect(r.users).toBe(0);
        expect(logs.join("\n")).toMatch(/refusing to create the public demo accounts/);
      }
      expect((await t2.db.select({ n: sql<number>`count(*)::int` }).from(user))[0]!.n).toBe(0);
      const local = await seed(t2.db, { env: { NODE_ENV: "development" } });
      expect(local.users).toBe(2);
      expect(await t2.db.select({ email: user.email }).from(user).orderBy(user.email)).toEqual([{ email: DEMO_ADMIN.email }, { email: DEMO_READER.email }]);
    } finally {
      await t2.close();
    }
  });
});
