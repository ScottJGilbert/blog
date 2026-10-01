import { eq, post } from "@blog/db";
import { PostDetailSchema, PostSummarySchema, SearchResultSchema, TagWithCountSchema, SitemapEntrySchema } from "@blog/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp, type TestApp } from "../helpers";
import { BASE, daysAgo, ensureAuthor, insertPost } from "./fixtures";

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ deps: { now: () => BASE } });
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await ensureAuthor(t);
});

const get = (path: string) => request(t.app).get(`/api${path}`);

describe("GET /posts", () => {
  it("lists published posts newest first with the PostSummary shape and pagination meta", async () => {
    await insertPost(t, { slug: "oldest", publishedAt: daysAgo(10), tags: ["Rust"] });
    await insertPost(t, { slug: "middle", publishedAt: daysAgo(5), section: "personal" });
    await insertPost(t, { slug: "newest", publishedAt: daysAgo(1), tags: ["Rust", "Web Dev"] });
    const res = await get("/posts").expect(200);
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual(["newest", "middle", "oldest"]);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 10, total: 3, totalPages: 1 });
    for (const item of res.body.data) expect(() => PostSummarySchema.parse(item)).not.toThrow();
    expect(res.body.data[0]).not.toHaveProperty("content");
    expect(res.body.data[0].tags).toEqual([
      { slug: "rust", name: "Rust" },
      { slug: "web-dev", name: "Web Dev" },
    ]);
    expect(res.body.data[0].author).toEqual({ name: "Ada Author", image: null });
    expect(res.headers["cache-control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });

  it("paginates and sorts", async () => {
    for (let i = 1; i <= 5; i++) await insertPost(t, { slug: `post-${i}`, publishedAt: daysAgo(10 - i) });
    const p1 = await get("/posts?pageSize=2&page=1").expect(200);
    const p3 = await get("/posts?pageSize=2&page=3").expect(200);
    const p9 = await get("/posts?pageSize=2&page=9").expect(200);
    expect(p1.body.data.map((p: { slug: string }) => p.slug)).toEqual(["post-5", "post-4"]);
    expect(p1.body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(p3.body.data.map((p: { slug: string }) => p.slug)).toEqual(["post-1"]);
    expect(p9.body.data).toEqual([]);
    const oldest = await get("/posts?sort=oldest&pageSize=2").expect(200);
    expect(oldest.body.data.map((p: { slug: string }) => p.slug)).toEqual(["post-1", "post-2"]);
  });

  it("filters by section, tag and q", async () => {
    await insertPost(t, { slug: "eng-rust", section: "engineering", tags: ["Rust"], title: "Rust ownership explained", markdown: "Borrow checker and lifetimes." });
    await insertPost(t, { slug: "eng-go", section: "engineering", tags: ["Go"], title: "Goroutines", markdown: "Channels everywhere." });
    await insertPost(t, { slug: "pers-rust", section: "personal", tags: ["Rust"], title: "Learning Rust at 40", markdown: "A diary." });
    const slugs = (r: request.Response) => r.body.data.map((p: { slug: string }) => p.slug).sort();
    expect(slugs(await get("/posts?section=personal"))).toEqual(["pers-rust"]);
    expect(slugs(await get("/posts?tag=rust"))).toEqual(["eng-rust", "pers-rust"]);
    expect(slugs(await get("/posts?tag=rust&section=engineering"))).toEqual(["eng-rust"]);
    expect(slugs(await get("/posts?q=goroutines"))).toEqual(["eng-go"]);
    expect(slugs(await get("/posts?tag=unknown"))).toEqual([]);
    expect((await get("/posts?tag=unknown")).body.meta.total).toBe(0);
  });

  it("never exposes drafts, scheduled, archived or future-dated posts", async () => {
    await insertPost(t, { slug: "visible" });
    await insertPost(t, { slug: "draft", status: "draft" });
    await insertPost(t, { slug: "scheduled", status: "scheduled", scheduledFor: daysAgo(-3) });
    await insertPost(t, { slug: "archived", status: "archived", publishedAt: daysAgo(3) });
    await insertPost(t, { slug: "future", status: "published", publishedAt: daysAgo(-2) });
    const res = await get("/posts").expect(200);
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual(["visible"]);
    for (const slug of ["draft", "scheduled", "archived", "future"]) {
      const r = await get(`/posts/${slug}`).expect(404);
      expect(r.body.error.code).toBe("not_found");
    }
    await get("/posts/draft/related").expect(404);
    expect((await get("/tags")).body.data).toEqual([]);
    expect((await get("/sitemap")).body.data.map((e: { slug: string }) => e.slug)).toEqual(["visible"]);
  });

  it("validates query parameters with the error envelope", async () => {
    const res = await get("/posts?pageSize=500").expect(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    await get("/posts?section=nope").expect(400);
    await get("/posts?page=0").expect(400);
  });

  it("a post becomes visible once the injected clock passes publishedAt", async () => {
    let now = BASE;
    const t2 = await buildTestApp({ deps: { now: () => now } });
    try {
      await ensureAuthor(t2);
      await insertPost(t2, { slug: "soon", publishedAt: new Date(BASE.getTime() + 60_000) });
      await request(t2.app).get("/api/posts/soon").expect(404);
      now = new Date(BASE.getTime() + 120_000);
      await request(t2.app).get("/api/posts/soon").expect(200);
    } finally {
      await t2.close();
    }
  });
});

describe("GET /posts/:slug", () => {
  const md = `# Intro heading

Hello **world** with <script>alert(1)</script> text.

## Second heading

More.

## Second heading

Duplicate title.

### Deep one
`;

  it("returns PostDetail with content, html, toc consistent with heading ids, and prev/next in the same section", async () => {
    await insertPost(t, { slug: "a-first", section: "engineering", publishedAt: daysAgo(9), title: "First" });
    await insertPost(t, { slug: "b-middle", section: "engineering", publishedAt: daysAgo(5), title: "Middle", markdown: md, tags: ["Rust"] });
    await insertPost(t, { slug: "c-other-section", section: "personal", publishedAt: daysAgo(4), title: "Elsewhere" });
    await insertPost(t, { slug: "d-last", section: "engineering", publishedAt: daysAgo(2), title: "Last" });
    const res = await get("/posts/b-middle").expect(200);
    const d = res.body.data;
    expect(() => PostDetailSchema.parse(d)).not.toThrow();
    expect(d.slug).toBe("b-middle");
    expect(d.content.root.type).toBe("root");
    expect(d.tags).toEqual([{ slug: "rust", name: "Rust" }]);
    expect(d.prev).toEqual({ slug: "a-first", title: "First", section: "engineering" });
    expect(d.next).toEqual({ slug: "d-last", title: "Last", section: "engineering" });
    // every TOC id appears as a heading id in the HTML, in order
    expect(d.toc.map((e: { text: string }) => e.text)).toEqual(["Intro heading", "Second heading", "Second heading", "Deep one"]);
    expect(new Set(d.toc.map((e: { id: string }) => e.id)).size).toBe(4);
    const htmlIds = [...d.contentHtml.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(htmlIds).toEqual(d.toc.map((e: { id: string }) => e.id));
    // content is rendered safely
    expect(d.contentHtml).not.toContain("<script>");
    expect(d.contentHtml).toContain("&lt;script&gt;");
    expect(res.headers["cache-control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
    expect(res.headers.etag).toMatch(/^W\//);
  });

  it("first/last posts have null prev/next; unknown slug is a 404 envelope", async () => {
    await insertPost(t, { slug: "only" });
    const d = (await get("/posts/only").expect(200)).body.data;
    expect(d.prev).toBeNull();
    expect(d.next).toBeNull();
    const r = await get("/posts/nope").expect(404);
    expect(r.body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("answers If-None-Match with 304", async () => {
    await insertPost(t, { slug: "etag-me" });
    const first = await get("/posts/etag-me").expect(200);
    await get("/posts/etag-me").set("If-None-Match", first.headers.etag!).expect(304);
  });

  it("is also served without the /api prefix", async () => {
    await insertPost(t, { slug: "bare" });
    await request(t.app).get("/posts/bare").expect(200);
  });

  it("reflects content updates immediately (no stale derived data)", async () => {
    const id = await insertPost(t, { slug: "mutable", title: "Before" });
    await t.db.update(post).set({ title: "After" }).where(eq(post.id, id));
    expect((await get("/posts/mutable")).body.data.title).toBe("After");
  });
});

describe("GET /tags and /sitemap", () => {
  it("counts only published posts and sorts by popularity", async () => {
    await insertPost(t, { slug: "p1", tags: ["Rust", "Web"] });
    await insertPost(t, { slug: "p2", tags: ["Rust"] });
    await insertPost(t, { slug: "p3", status: "draft", tags: ["Secret"] });
    const res = await get("/tags").expect(200);
    expect(res.body.data).toEqual([
      { slug: "rust", name: "Rust", count: 2 },
      { slug: "web", name: "Web", count: 1 },
    ]);
    for (const x of res.body.data) TagWithCountSchema.parse(x);
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
  });

  it("sitemap lists section, slug and updatedAt", async () => {
    await insertPost(t, { slug: "map-me", section: "personal" });
    const res = await get("/sitemap").expect(200);
    expect(res.body.data).toHaveLength(1);
    SitemapEntrySchema.parse(res.body.data[0]);
    expect(res.body.data[0]).toMatchObject({ section: "personal", slug: "map-me" });
  });
});

describe("GET /search (full-text only)", () => {
  it("ranks title matches and returns highlighted, HTML-safe snippets", async () => {
    await insertPost(t, {
      slug: "kubernetes-guide",
      title: "Kubernetes in anger",
      markdown: "We ran kubernetes in production. <img src=x onerror=alert(1)> Pods & services <b>bold</b> everywhere.",
    });
    await insertPost(t, { slug: "unrelated", title: "Gardening", markdown: "Tomatoes love sun." });
    const res = await get("/search?q=kubernetes").expect(200);
    expect(res.body.meta.total).toBe(1);
    const item = res.body.data[0];
    expect(() => SearchResultSchema.parse(item)).not.toThrow();
    expect(item.slug).toBe("kubernetes-guide");
    expect(item.snippet).toContain("<mark>");
    // only <mark> survives, everything else is escaped
    const stripped = item.snippet.replaceAll("<mark>", "").replaceAll("</mark>", "");
    expect(stripped).not.toMatch(/[<>]/);
    expect(item.snippet).toContain("&lt;img");
    expect(item.score).toBeGreaterThan(0);
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
  });

  it("is safe with punctuation, quotes, operators and stop words", async () => {
    await insertPost(t, { slug: "weird", title: "C++ and the Rust-lang", markdown: "Operators & such: (a|b) !c <d>." });
    for (const q of ["c++", `"unterminated`, "a & b | !c", "(((", "'; drop table post; --", "the", "%_", "\\\\", "--", "<script>alert(1)</script>"]) {
      const r = await get(`/search?q=${encodeURIComponent(q)}`);
      expect([200]).toContain(r.status);
      expect(Array.isArray(r.body.data)).toBe(true);
    }
    const stopOnly = await get("/search?q=" + encodeURIComponent("to be or not")).expect(200);
    expect(stopOnly.body.data).toEqual([]);
  });

  it("falls back to a title substring match when full-text finds nothing (prefixes)", async () => {
    await insertPost(t, { slug: "postgres-tips", title: "Postgres tips and tricks", markdown: "Indexes." });
    const res = await get("/search?q=postgr").expect(200);
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual(["postgres-tips"]);
  });

  it("validates q: min length 2, max length 200, required", async () => {
    await get("/search").expect(400);
    await get("/search?q=a").expect(400);
    await get(`/search?q=${"x".repeat(201)}`).expect(400);
    await get(`/search?q=${"x".repeat(200)}`).expect(200);
  });

  it("filters by section and paginates", async () => {
    for (let i = 0; i < 3; i++) await insertPost(t, { slug: `eng-${i}`, section: "engineering", title: `Widgets ${i}`, markdown: "widgets" });
    await insertPost(t, { slug: "pers-0", section: "personal", title: "Widgets personal", markdown: "widgets" });
    const eng = await get("/search?q=widgets&section=engineering&pageSize=2").expect(200);
    expect(eng.body.meta).toMatchObject({ total: 3, totalPages: 2, pageSize: 2 });
    expect(eng.body.data).toHaveLength(2);
    expect(eng.body.data.every((p: { section: string }) => p.section === "engineering")).toBe(true);
  });
});
