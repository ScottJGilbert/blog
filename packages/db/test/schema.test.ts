import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  account, apiKey, comment, commentReport, EMBEDDING_DIMENSIONS, media, newsletter, post, postEmbedding, postTag,
  session, subscriber, tag, user,
} from "../src/schema/index";
import { createTestDb, type TestDb } from "../src/testing";
import { insertPost, insertUser, lexical, pgErrorCode } from "./helpers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.truncateAll();
});

const UNIQUE = "23505";
const FK = "23503";
const CHECK = "23514";

describe("users & auth tables", () => {
  it("defaults role reader, banned false; email unique; role constrained", async () => {
    const u = await insertUser(t.db, { email: "a@example.com" });
    expect(u.role).toBe("reader");
    expect(u.banned).toBe(false);
    expect(u.emailVerified).toBe(false);
    expect(await pgErrorCode(insertUser(t.db, { email: "a@example.com" }))).toBe(UNIQUE);
    expect(await pgErrorCode(insertUser(t.db, { role: "superuser" as "admin" }))).toBe(CHECK);
  });

  it("cascades sessions and accounts when a user is deleted", async () => {
    const u = await insertUser(t.db);
    await t.db.insert(session).values({ id: "s1", token: "tok", userId: u.id, expiresAt: new Date(Date.now() + 1000) });
    await t.db.insert(account).values({ id: "a1", accountId: u.id, providerId: "credential", userId: u.id });
    await t.db.delete(user).where(eq(user.id, u.id));
    expect(await t.db.select().from(session)).toHaveLength(0);
    expect(await t.db.select().from(account)).toHaveLength(0);
  });
});

describe("posts", () => {
  it("enforces unique slug, slug format, status/date rules and the author FK", async () => {
    const u = await insertUser(t.db);
    await insertPost(t.db, u.id, { slug: "same" });
    expect(await pgErrorCode(insertPost(t.db, u.id, { slug: "same" }))).toBe(UNIQUE);
    expect(await pgErrorCode(insertPost(t.db, u.id, { slug: "Bad Slug" }))).toBe(CHECK);
    expect(await pgErrorCode(insertPost(t.db, u.id, { status: "published" }))).toBe(CHECK);
    expect(await pgErrorCode(insertPost(t.db, u.id, { status: "scheduled" }))).toBe(CHECK);
    expect(await pgErrorCode(insertPost(t.db, u.id, { readingMinutes: 0 }))).toBe(CHECK);
    expect(await pgErrorCode(insertPost(t.db, randomUUID()))).toBe(FK);
    await insertPost(t.db, u.id, { status: "published", publishedAt: new Date() });
    // restrict: cannot delete an author who has posts
    expect(await pgErrorCode(t.db.delete(user).where(eq(user.id, u.id)))).toBe(FK);
  });

  it("matches full-text queries using the generated tsvector with A/B/C weights", async () => {
    const u = await insertUser(t.db);
    const a = await insertPost(t.db, u.id, { title: "Kubernetes operators", excerpt: "x", contentText: "nothing" });
    const b = await insertPost(t.db, u.id, { title: "Other", excerpt: "kubernetes deep dive", contentText: "nothing" });
    const c = await insertPost(t.db, u.id, { title: "Third", excerpt: "x", contentText: "we deploy to kubernetes daily" });
    await insertPost(t.db, u.id, { title: "Unrelated", excerpt: "x", contentText: "bread baking" });

    const q = sql`websearch_to_tsquery('english', 'kubernetes')`;
    const rows = await t.db
      .select({ id: post.id, rank: sql<number>`ts_rank(${post.searchVector}, ${q})` })
      .from(post)
      .where(sql`${post.searchVector} @@ ${q}`)
      .orderBy(sql`ts_rank(${post.searchVector}, ${q}) desc`);
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]); // title > excerpt > body

    // stemming + generated column follows updates
    await t.db.update(post).set({ contentText: "bread baking and deployments" }).where(eq(post.id, c.id));
    const after = await t.db.select({ id: post.id }).from(post).where(sql`${post.searchVector} @@ websearch_to_tsquery('english', 'deploy')`);
    expect(after.map((r) => r.id)).toEqual([c.id]);
    // cannot write the generated column
    expect(await pgErrorCode(t.db.execute(sql`update post set search_vector = to_tsvector('x') where id = ${c.id}`))).toBeDefined();
  });

  it("supports tags with composite PK and cascades", async () => {
    const u = await insertUser(t.db);
    const p = await insertPost(t.db, u.id);
    const [tg] = await t.db.insert(tag).values({ slug: "typescript", name: "TypeScript" }).returning();
    expect(await pgErrorCode(t.db.insert(tag).values({ slug: "typescript", name: "dup" }))).toBe(UNIQUE);
    expect(await pgErrorCode(t.db.insert(tag).values({ slug: "Not Ok", name: "x" }))).toBe(CHECK);
    await t.db.insert(postTag).values({ postId: p.id, tagId: tg!.id });
    expect(await pgErrorCode(t.db.insert(postTag).values({ postId: p.id, tagId: tg!.id }))).toBe(UNIQUE);
    await t.db.delete(post).where(eq(post.id, p.id));
    expect(await t.db.select().from(postTag)).toHaveLength(0);
  });
});

describe("pgvector", () => {
  const vec = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed * (i + 1)));

  it("stores embeddings and answers cosine-distance (<=>) nearest-neighbour queries", async () => {
    const u = await insertUser(t.db);
    const posts = await Promise.all([1, 2, 3].map(() => insertPost(t.db, u.id)));
    const seeds = [1, 2, 3];
    await t.db.insert(postEmbedding).values(
      posts.map((p, i) => ({ postId: p.id, model: "test", contentHash: `h${i}`, embedding: vec(seeds[i]!) })),
    );
    const query = vec(2.01);
    const lit = sql.raw(`'[${query.join(",")}]'::vector`);
    const rows = await t.db
      .select({ postId: postEmbedding.postId, dist: sql<number>`${postEmbedding.embedding} <=> ${lit}` })
      .from(postEmbedding)
      .orderBy(sql`${postEmbedding.embedding} <=> ${lit}`)
      .limit(3);
    expect(rows[0]!.postId).toBe(posts[1]!.id);
    expect(rows[0]!.dist).toBeLessThan(rows[1]!.dist);
    // round-trips as number[]
    const [stored] = await t.db.select().from(postEmbedding).where(eq(postEmbedding.postId, posts[0]!.id));
    expect(stored!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    // wrong dimension is rejected; cascade on post delete
    expect(await pgErrorCode(t.db.insert(postEmbedding).values({ postId: posts[0]!.id, model: "m", contentHash: "x", embedding: [1, 2, 3] }))).toBeDefined();
    await t.db.delete(post).where(eq(post.id, posts[0]!.id));
    expect(await t.db.select().from(postEmbedding)).toHaveLength(2);
  });
});

describe("comments", () => {
  it("limits body length, depth 1, same-post replies; cascades; unique reports", async () => {
    const u = await insertUser(t.db);
    const p1 = await insertPost(t.db, u.id);
    const p2 = await insertPost(t.db, u.id);
    const [top] = await t.db.insert(comment).values({ postId: p1.id, authorId: u.id, body: "top" }).returning();
    const [reply] = await t.db.insert(comment).values({ postId: p1.id, authorId: u.id, body: "r", parentId: top!.id }).returning();

    expect(await pgErrorCode(t.db.insert(comment).values({ postId: p1.id, authorId: u.id, body: "" }))).toBe(CHECK);
    expect(await pgErrorCode(t.db.insert(comment).values({ postId: p1.id, authorId: u.id, body: "x".repeat(4001) }))).toBe(CHECK);
    await t.db.insert(comment).values({ postId: p1.id, authorId: u.id, body: "x".repeat(4000) });
    // reply to a reply -> rejected by trigger
    expect(await pgErrorCode(t.db.insert(comment).values({ postId: p1.id, authorId: u.id, body: "deep", parentId: reply!.id }))).toBe(CHECK);
    // reply on a different post than parent -> rejected
    expect(await pgErrorCode(t.db.insert(comment).values({ postId: p2.id, authorId: u.id, body: "x", parentId: top!.id }))).toBe(CHECK);
    // missing parent -> FK
    expect(await pgErrorCode(t.db.insert(comment).values({ postId: p1.id, authorId: u.id, body: "x", parentId: randomUUID() }))).toBe(FK);

    await t.db.insert(commentReport).values({ commentId: top!.id, reporterId: u.id, reason: "spam" });
    expect(await pgErrorCode(t.db.insert(commentReport).values({ commentId: top!.id, reporterId: u.id, reason: "again" }))).toBe(UNIQUE);
    expect(await pgErrorCode(t.db.insert(commentReport).values({ commentId: reply!.id, reporterId: u.id, reason: "x" }))).toBe(CHECK);

    // deleting the author keeps the comment (author set null); deleting the parent cascades replies + reports
    const other = await insertUser(t.db);
    const [oc] = await t.db.insert(comment).values({ postId: p1.id, authorId: other.id, body: "mine" }).returning();
    await t.db.delete(user).where(eq(user.id, other.id));
    const [kept] = await t.db.select().from(comment).where(eq(comment.id, oc!.id));
    expect(kept!.authorId).toBeNull();
    await t.db.delete(comment).where(eq(comment.id, top!.id));
    expect(await t.db.select().from(commentReport)).toHaveLength(0);
    expect(await t.db.select().from(comment).where(eq(comment.id, reply!.id))).toHaveLength(0);
  });
});

describe("newsletter, subscribers, media, api keys", () => {
  it("keeps subscriber emails lowercase and tokens unique", async () => {
    await t.db.insert(subscriber).values({ email: "a@example.com", unsubscribeToken: "u1", confirmToken: "c1" });
    expect(await pgErrorCode(t.db.insert(subscriber).values({ email: "A@Example.com", unsubscribeToken: "u2" }))).toBe(CHECK);
    expect(await pgErrorCode(t.db.insert(subscriber).values({ email: "a@example.com", unsubscribeToken: "u3" }))).toBe(UNIQUE);
    expect(await pgErrorCode(t.db.insert(subscriber).values({ email: "b@example.com", unsubscribeToken: "u1" }))).toBe(UNIQUE);
  });

  it("newsletters require scheduled_for when scheduled; post deletion keeps the newsletter", async () => {
    const u = await insertUser(t.db);
    const p = await insertPost(t.db, u.id);
    const [n] = await t.db.insert(newsletter).values({ subject: "Hi", postId: p.id, content: lexical(), createdBy: u.id }).returning();
    expect(n!.status).toBe("draft");
    expect(await pgErrorCode(t.db.insert(newsletter).values({ subject: "x", status: "scheduled" }))).toBe(CHECK);
    await t.db.delete(post).where(eq(post.id, p.id));
    const [after] = await t.db.select().from(newsletter).where(eq(newsletter.id, n!.id));
    expect(after!.postId).toBeNull();
  });

  it("media keys are unique; api key hashes unique and scopes validated", async () => {
    await t.db.insert(media).values({ key: "k1", url: "/u/k1", mime: "image/png", sizeBytes: 10 });
    expect(await pgErrorCode(t.db.insert(media).values({ key: "k1", url: "/u/k1", mime: "image/png", sizeBytes: 10 }))).toBe(UNIQUE);
    expect(await pgErrorCode(t.db.insert(media).values({ key: "k2", url: "/u", mime: "image/png", sizeBytes: -1 }))).toBe(CHECK);

    await t.db.insert(apiKey).values({ name: "k", prefix: "blg_abcd", keyHash: "h", scopes: ["posts:read"] });
    expect(await pgErrorCode(t.db.insert(apiKey).values({ name: "k", prefix: "blg_abcd", keyHash: "h" }))).toBe(UNIQUE);
    expect(await pgErrorCode(t.db.insert(apiKey).values({ name: "k", prefix: "blg_zzzz", keyHash: "h2", scopes: ["root" as "posts:read"] }))).toBe(CHECK);
    const [def] = await t.db.insert(apiKey).values({ name: "d", prefix: "blg_dddd", keyHash: "h3" }).returning();
    expect(def!.scopes).toEqual([]);
  });
});
