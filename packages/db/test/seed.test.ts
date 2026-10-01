import { SUPPORTED_NODE_TYPES, renderHtml, type Content } from "@blog/content";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { account, comment, post, postTag, tag, user } from "../src/schema/index";
import { DEMO_ADMIN, DEMO_READER, seed } from "../src/seed";
import { SEED_POSTS } from "../src/seed-content";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

function nodeTypes(node: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => nodeTypes(n, acc));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.type === "string") acc.add(o.type);
    Object.values(o).forEach((v) => nodeTypes(v, acc));
  }
  return acc;
}

describe("seed", () => {
  it("is idempotent", async () => {
    const first = await seed(t.db, { demoData: true });
    const counts = async () => ({
      posts: (await t.db.select({ n: sql<number>`count(*)::int` }).from(post))[0]!.n,
      tags: (await t.db.select({ n: sql<number>`count(*)::int` }).from(tag))[0]!.n,
      users: (await t.db.select({ n: sql<number>`count(*)::int` }).from(user))[0]!.n,
      accounts: (await t.db.select({ n: sql<number>`count(*)::int` }).from(account))[0]!.n,
      comments: (await t.db.select({ n: sql<number>`count(*)::int` }).from(comment))[0]!.n,
      postTags: (await t.db.select({ n: sql<number>`count(*)::int` }).from(postTag))[0]!.n,
    });
    const a = await counts();
    const second = await seed(t.db, { demoData: true });
    expect(await counts()).toEqual(a);
    expect(first.comments).toBe(3);
    expect(second.comments).toBe(0);
    expect(a.posts).toBe(SEED_POSTS.length);
    expect(a.users).toBe(2);
  });

  it("creates ~6 published posts across both sections with derived fields", async () => {
    const rows = await t.db.select().from(post).where(eq(post.status, "published"));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(new Set(rows.map((r) => r.section))).toEqual(new Set(["personal", "engineering"]));
    for (const r of rows) {
      expect(r.contentText.length).toBeGreaterThan(100);
      expect(r.excerpt.length).toBeGreaterThan(20);
      expect(r.readingMinutes).toBeGreaterThanOrEqual(1);
      expect(r.publishedAt!.getTime()).toBeLessThanOrEqual(Date.now());
      // rendering never throws and escapes
      expect(renderHtml(r.content as unknown as Content, { target: "web" })).toContain("<");
    }
  });

  it("covers most BCF node types", () => {
    const used = new Set<string>();
    for (const p of SEED_POSTS) nodeTypes(p.content, used);
    const missing = SUPPORTED_NODE_TYPES.filter((n) => !used.has(n));
    // only exotic nodes may be absent
    expect(missing.filter((m) => !["overflow", "autolink", "page-break", "code-highlight"].includes(m))).toEqual([]);
  });

  it("makes seeded text searchable through the generated tsvector", async () => {
    const hits = await t.db
      .select({ slug: post.slug })
      .from(post)
      .where(sql`${post.searchVector} @@ websearch_to_tsquery('english', 'reciprocal rank fusion')`);
    expect(hits.map((h) => h.slug)).toContain("hybrid-search-fusing-full-text-and-vectors");
  });

  it("creates demo accounts that Better Auth's hasher accepts", async () => {
    for (const [u, role] of [[DEMO_ADMIN, "admin"], [DEMO_READER, "reader"]] as const) {
      const [row] = await t.db.select().from(user).where(eq(user.email, u.email));
      expect(row).toMatchObject({ role, emailVerified: true, banned: false });
      const [acc] = await t.db.select().from(account).where(and(eq(account.userId, row!.id), eq(account.providerId, "credential")));
      expect(await verifyPassword({ hash: acc!.password!, password: u.password })).toBe(true);
      expect(await verifyPassword({ hash: acc!.password!, password: "wrong" })).toBe(false);
    }
  });

  it("without demo data (production) creates no users and skips posts when there is no admin", async () => {
    const t2 = await createTestDb();
    try {
      const r = await seed(t2.db, { demoData: false });
      expect(r).toEqual({ tags: 11, posts: 0, users: 0, comments: 0 });
    } finally {
      await t2.close();
    }
  });
});
