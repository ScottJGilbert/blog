import { eq, post, postEmbedding } from "@blog/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp, type TestApp } from "../helpers";
import { embedPost, reindexAll, waitForReindex } from "../../src/services/posts/embeddings";
import { BASE, daysAgo, ensureAuthor, FakeEmbeddings, insertPost, setEmbedding, topicVector } from "./fixtures";

let t: TestApp;
const fake = new FakeEmbeddings();
beforeAll(async () => {
  t = await buildTestApp({ deps: { now: () => BASE, embeddings: fake } });
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  fake.calls = [];
  fake.fail = false;
  await ensureAuthor(t);
});

const get = (path: string) => request(t.app).get(`/api${path}`);
const slugs = (r: request.Response) => r.body.data.map((p: { slug: string }) => p.slug);

describe("embedPost / reindexAll", () => {
  it("embeds, skips unchanged content, re-embeds changed content", async () => {
    const id = await insertPost(t, { slug: "e1", title: "alpha post", markdown: "alpha body" });
    expect(await embedPost(t.deps, id)).toEqual({ status: "embedded" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]![0]).toContain("alpha post");
    expect(await embedPost(t.deps, id)).toEqual({ status: "skipped" });
    expect(fake.calls).toHaveLength(1);
    await t.db.update(post).set({ title: "bravo post" }).where(eq(post.id, id));
    expect(await embedPost(t.deps, id)).toEqual({ status: "embedded" });
    const [row] = await t.db.select().from(postEmbedding).where(eq(postEmbedding.postId, id));
    expect(row!.model).toBe("fake-model");
    expect(row!.embedding).toHaveLength(1536);
  });

  it("never throws: provider failure and unknown post are reported as failed; disabled provider as disabled", async () => {
    const id = await insertPost(t, { slug: "e2" });
    fake.fail = true;
    expect(await embedPost(t.deps, id)).toEqual({ status: "failed" });
    expect(await embedPost(t.deps, "00000000-0000-4000-8000-000000000000")).toEqual({ status: "failed" });
    const disabled = await buildTestApp();
    try {
      expect(await embedPost(disabled.deps, id)).toEqual({ status: "disabled" });
      expect(await reindexAll(disabled.deps)).toEqual({ queued: 0 });
    } finally {
      await disabled.close();
    }
  });

  it("reindexAll embeds all published posts in the background", async () => {
    for (let i = 0; i < 20; i++) await insertPost(t, { slug: `bulk-${i}`, markdown: "alpha" });
    await insertPost(t, { slug: "draft-one", status: "draft" });
    const res = await reindexAll(t.deps);
    expect(res).toEqual({ queued: 20 });
    const summary = await waitForReindex(t.deps);
    expect(summary).toEqual({ embedded: 20, skipped: 0, failed: 0 });
    expect(fake.calls.length).toBe(2); // 16 + 4, batched
    const rows = await t.db.select().from(postEmbedding);
    expect(rows).toHaveLength(20);
    // second run: everything unchanged
    await reindexAll(t.deps);
    expect(await waitForReindex(t.deps)).toEqual({ embedded: 0, skipped: 20, failed: 0 });
  });
});

describe("GET /posts/:slug/related", () => {
  it("ranks by vector similarity when the post has an embedding and never includes itself", async () => {
    const self = await insertPost(t, { slug: "self", tags: ["x"], publishedAt: daysAgo(9) });
    const near = await insertPost(t, { slug: "near", publishedAt: daysAgo(8) });
    const mid = await insertPost(t, { slug: "mid", publishedAt: daysAgo(7) });
    const far = await insertPost(t, { slug: "far", publishedAt: daysAgo(6), tags: ["x"] });
    await setEmbedding(t, self, topicVector({ alpha: 1 }));
    await setEmbedding(t, near, topicVector({ alpha: 1, bravo: 0.1 }));
    await setEmbedding(t, mid, topicVector({ alpha: 1, bravo: 1 }));
    await setEmbedding(t, far, topicVector({ charlie: 1 }));
    const res = await get("/posts/self/related?limit=3").expect(200);
    expect(slugs(res)).toEqual(["near", "mid", "far"]);
    expect(slugs(await get("/posts/self/related?limit=1"))).toEqual(["near"]);
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
  });

  it("falls back to tag overlap (ordered by shared tags) when the post has no embedding", async () => {
    await insertPost(t, { slug: "self", tags: ["a", "b", "c"], publishedAt: daysAgo(9) });
    await insertPost(t, { slug: "one-shared", tags: ["a"], publishedAt: daysAgo(1) });
    await insertPost(t, { slug: "two-shared", tags: ["a", "b"], publishedAt: daysAgo(5) });
    await insertPost(t, { slug: "none-shared", tags: ["z"], publishedAt: daysAgo(2) });
    const res = await get("/posts/self/related?limit=2").expect(200);
    expect(slugs(res)).toEqual(["two-shared", "one-shared"]);
  });

  it("tops up with the newest posts of the same section, ignoring other sections and unpublished posts", async () => {
    await insertPost(t, { slug: "self", section: "engineering", tags: ["a"], publishedAt: daysAgo(9) });
    await insertPost(t, { slug: "tagged", section: "engineering", tags: ["a"], publishedAt: daysAgo(8) });
    await insertPost(t, { slug: "eng-new", section: "engineering", publishedAt: daysAgo(1) });
    await insertPost(t, { slug: "eng-old", section: "engineering", publishedAt: daysAgo(4) });
    await insertPost(t, { slug: "personal", section: "personal", publishedAt: daysAgo(1) });
    await insertPost(t, { slug: "draft", section: "engineering", status: "draft" });
    const res = await get("/posts/self/related?limit=3").expect(200);
    expect(slugs(res)).toEqual(["tagged", "eng-new", "eng-old"]);
  });

  it("returns an empty list for a lone post and validates the limit", async () => {
    await insertPost(t, { slug: "alone" });
    expect((await get("/posts/alone/related")).body.data).toEqual([]);
    await get("/posts/alone/related?limit=0").expect(400);
    await get("/posts/alone/related?limit=13").expect(400);
  });
});

describe("hybrid search", () => {
  it("fuses full-text and vector results (vector-only hits appear; both-hits rank first)", async () => {
    // query "alpha": FTS matches by the word, the fake provider maps the query to the alpha axis
    const both = await insertPost(t, { slug: "both", title: "Alpha everywhere", markdown: "alpha alpha alpha", publishedAt: daysAgo(5) });
    const ftsOnly = await insertPost(t, { slug: "fts-only", title: "Mentions alpha once", markdown: "A passing mention of alpha.", publishedAt: daysAgo(4) });
    const vecOnly = await insertPost(t, { slug: "vec-only", title: "Totally different words", markdown: "Nothing in common textually.", publishedAt: daysAgo(3) });
    const unrelated = await insertPost(t, { slug: "unrelated", title: "Gardening", markdown: "Tomatoes.", publishedAt: daysAgo(2) });
    await setEmbedding(t, both, topicVector({ alpha: 1 }));
    await setEmbedding(t, ftsOnly, topicVector({ bravo: 1 }));
    await setEmbedding(t, vecOnly, topicVector({ alpha: 1, bravo: 0.2 }));
    await setEmbedding(t, unrelated, topicVector({ charlie: 1 }));
    const res = await get("/search?q=alpha").expect(200);
    expect(slugs(res)[0]).toBe("both");
    expect(slugs(res)).toContain("fts-only");
    expect(slugs(res)).toContain("vec-only");
    expect(slugs(res)).not.toContain("unrelated");
    expect(res.body.meta.total).toBe(3);
    expect(res.body.data[0].score).toBeGreaterThan(res.body.data[1].score);
    // vector-only results still carry a safe snippet
    const vec = res.body.data.find((p: { slug: string }) => p.slug === "vec-only");
    expect(typeof vec.snippet).toBe("string");
    expect(vec.snippet).not.toContain("<mark>");
  });

  it("respects the section filter on the vector side", async () => {
    const a = await insertPost(t, { slug: "eng", section: "engineering", title: "Unrelated words", markdown: "text" });
    const b = await insertPost(t, { slug: "pers", section: "personal", title: "Other words", markdown: "text" });
    await setEmbedding(t, a, topicVector({ alpha: 1 }));
    await setEmbedding(t, b, topicVector({ alpha: 1 }));
    expect(slugs(await get("/search?q=alpha&section=personal"))).toEqual(["pers"]);
  });

  it("falls back to full-text only when the provider fails", async () => {
    const id = await insertPost(t, { slug: "ft", title: "Alpha text", markdown: "alpha" });
    await setEmbedding(t, id, topicVector({ alpha: 1 }));
    const other = await insertPost(t, { slug: "vec", title: "Nope", markdown: "nope" });
    await setEmbedding(t, other, topicVector({ alpha: 1 }));
    fake.fail = true;
    const res = await get("/search?q=alpha").expect(200);
    expect(slugs(res)).toEqual(["ft"]);
  });
});
