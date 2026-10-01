import { auditLog, eq, media, post, postEmbedding, postTag, tag } from "@blog/db";
import { AdminPostDetailSchema, AdminPostSummarySchema } from "@blog/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, type TestApp } from "../helpers";
import { png, dataUri, svg } from "../fakes/images";
import { API, adminSession, auditActions, createPostVia, doc, docWithImage, insertPost, type Admin } from "./helpers";
import type { EmbeddingProvider } from "../../src/services/embeddings";

const revalidate = vi.fn(async (_tags: string[]) => undefined);
const embed = vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))));
const embeddings: EmbeddingProvider = { enabled: true, model: "fake-model", embed };

let t: TestApp;
let admin: Admin;
beforeAll(async () => {
  t = await buildTestApp({ deps: { revalidate, embeddings } });
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  revalidate.mockClear();
  embed.mockClear();
  embed.mockImplementation(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))));
  admin = await adminSession(t);
});

const waitFor = async (fn: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

describe("create", () => {
  it("derives slug, excerpt, reading time, author; returns a valid AdminPostDetail", async () => {
    const res = await admin.agent
      .post(`${API}/posts`)
      .send({ title: "My First Post!", section: "personal", tags: ["Node.js", "Web Dev"], content: doc("Hello there, this is the body of the post.") })
      .expect(201);
    const p = AdminPostDetailSchema.parse(res.body.data);
    expect(p.slug).toBe("my-first-post");
    expect(p.status).toBe("draft");
    expect(p.publishedAt).toBeNull();
    expect(p.scheduledFor).toBeNull();
    expect(p.excerpt).toBe("Hello there, this is the body of the post.");
    expect(p.readingMinutes).toBeGreaterThanOrEqual(1);
    expect(p.author).toEqual({ id: admin.user.id, name: admin.user.name, image: null });
    expect(p.tags.map((x) => x.slug).sort()).toEqual(["node-js", "web-dev"]);
    expect(p.hasEmbedding).toBe(false);
    const [row] = await t.db.select().from(post).where(eq(post.id, p.id));
    expect(row!.contentText).toContain("Hello there");
    expect(row!.authorId).toBe(admin.user.id);
    expect(await auditActions(t)).toContain("post.create");
    expect(revalidate).not.toHaveBeenCalled(); // drafts do not touch the public site
  });

  it("keeps an explicit excerpt and cover image fields", async () => {
    const p = await createPostVia(admin.agent, { excerpt: "  My own excerpt ", coverImageUrl: "https://img.example/x.png", coverImageAlt: "alt text" });
    expect(p.excerpt).toBe("My own excerpt");
    expect(p.coverImageUrl).toBe("https://img.example/x.png");
    expect(p.coverImageAlt).toBe("alt text");
  });

  it("allocates unique slugs with numeric suffixes", async () => {
    const a = await createPostVia(admin.agent, { title: "Same Title" });
    const b = await createPostVia(admin.agent, { title: "Same Title" });
    const c = await createPostVia(admin.agent, { title: "Same Title" });
    expect([a.slug, b.slug, c.slug]).toEqual(["same-title", "same-title-2", "same-title-3"]);
  });

  it("uses a provided slug; a taken one is 409, an invalid one 400", async () => {
    const a = await createPostVia(admin.agent, { slug: "custom-slug" });
    expect(a.slug).toBe("custom-slug");
    const dup = await admin.agent.post(`${API}/posts`).send({ title: "x", section: "personal", content: doc("a"), slug: "custom-slug" }).expect(409);
    expect(dup.body.error.code).toBe("conflict");
    for (const slug of ["Bad Slug", "UPPER", "a--b", "-lead", "trail-", "../x"]) {
      const r = await admin.agent.post(`${API}/posts`).send({ title: "x", section: "personal", content: doc("a"), slug }).expect(400);
      expect(r.body.error.code).toBe("validation_error");
    }
  });

  it("falls back to a slug for titles without ASCII letters", async () => {
    const p = await createPostVia(admin.agent, { title: "日本語のタイトル" });
    expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("rejects structurally invalid content (400) and content that fails the BCF validator (422)", async () => {
    await admin.agent.post(`${API}/posts`).send({ title: "x", section: "personal", content: { nope: true } }).expect(400);
    const bad = doc("x");
    (bad.root.children[0] as any).children = [{ type: "link", version: 1, url: "javascript:alert(1)", children: [{ type: "text", version: 1, text: "click", format: 0, style: "", mode: "normal", detail: 0 }], direction: "ltr", format: "", indent: 0 }];
    const res = await admin.agent.post(`${API}/posts`).send({ title: "x", section: "personal", content: bad }).expect(422);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.details[0].code).toBe("unsafe-url");
    expect(await t.db.select().from(post)).toHaveLength(0);
  });

  it("stores unknown node types verbatim and reports warnings in a header", async () => {
    const content = doc("known");
    (content.root.children as unknown[]).push({ type: "future-widget", version: 3, payload: { a: 1 } });
    const res = await admin.agent.post(`${API}/posts`).send({ title: "Warn", section: "personal", content }).expect(201);
    expect(Number(res.headers["x-content-warnings"])).toBeGreaterThan(0);
    const [row] = await t.db.select().from(post).where(eq(post.id, res.body.data.id));
    expect((row!.content as any).root.children[1]).toEqual({ type: "future-widget", version: 3, payload: { a: 1 } });
  });

  it("validates fields: title, section, tags", async () => {
    const base = { title: "T", section: "personal", content: doc("a") };
    await admin.agent.post(`${API}/posts`).send({ ...base, title: "" }).expect(400);
    await admin.agent.post(`${API}/posts`).send({ ...base, section: "nope" }).expect(400);
    await admin.agent.post(`${API}/posts`).send({ ...base, tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }).expect(400);
    await admin.agent.post(`${API}/posts`).send({ ...base, status: "scheduled" }).expect(422);
  });

  it("creating directly as published sets publishedAt, revalidates and embeds", async () => {
    const p = await createPostVia(admin.agent, { title: "Live now", status: "published" });
    expect(p.status).toBe("published");
    expect(p.publishedAt).toBeTruthy();
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.mock.calls[0]![0]).toEqual(expect.arrayContaining(["posts", "post:live-now", "section:engineering", "tags"]));
    expect(await waitFor(async () => (await t.db.select().from(postEmbedding).where(eq(postEmbedding.postId, p.id))).length === 1)).toBe(true);
  });

  it("refuses to publish an empty document", async () => {
    const res = await admin.agent.post(`${API}/posts`).send({ title: "Empty", section: "personal", content: { root: { type: "root", children: [] } }, status: "published" }).expect(422);
    expect(res.body.error.message).toMatch(/without content/);
  });
});

describe("get / list", () => {
  it("get returns the full post, 404 for unknown / malformed ids", async () => {
    const p = await createPostVia(admin.agent, { tags: ["a"] });
    const res = await admin.agent.get(`${API}/posts/${p.id}`).expect(200);
    expect(AdminPostDetailSchema.parse(res.body.data).content.root.children).toHaveLength(1);
    await admin.agent.get(`${API}/posts/00000000-0000-4000-8000-000000000000`).expect(404);
    await admin.agent.get(`${API}/posts/not-a-uuid`).expect(404);
  });

  it("lists drafts too, without content, filtered and paginated", async () => {
    await insertPost(t, admin.user.id, { title: "Alpha draft", slug: "alpha", status: "draft", section: "personal" });
    await insertPost(t, admin.user.id, { title: "Beta published", slug: "beta", status: "published", publishedAt: new Date(), section: "engineering" });
    await insertPost(t, admin.user.id, { title: "Gamma scheduled", slug: "gamma", status: "scheduled", scheduledFor: new Date(Date.now() + 86_400_000), section: "engineering" });
    const all = await admin.agent.get(`${API}/posts`).expect(200);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 10, total: 3, totalPages: 1 });
    for (const item of all.body.data) {
      AdminPostSummarySchema.parse(item);
      expect(item.content).toBeUndefined();
    }
    const byStatus = await admin.agent.get(`${API}/posts?status=draft`).expect(200);
    expect(byStatus.body.data.map((x: any) => x.slug)).toEqual(["alpha"]);
    const bySection = await admin.agent.get(`${API}/posts?section=engineering`).expect(200);
    expect(bySection.body.meta.total).toBe(2);
    const bySearch = await admin.agent.get(`${API}/posts?q=BETA`).expect(200);
    expect(bySearch.body.data.map((x: any) => x.slug)).toEqual(["beta"]);
    const escaped = await admin.agent.get(`${API}/posts?q=${encodeURIComponent("100%_")}`).expect(200);
    expect(escaped.body.data).toEqual([]); // wildcards in input are literal
    const page = await admin.agent.get(`${API}/posts?pageSize=2&page=2`).expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    await admin.agent.get(`${API}/posts?pageSize=500`).expect(400);
    await admin.agent.get(`${API}/posts?status=bogus`).expect(400);
  });
});

describe("update", () => {
  it("is a partial update: omitted fields stay, tags only change when provided", async () => {
    const p = await createPostVia(admin.agent, { tags: ["One", "Two"], excerpt: "keep me" });
    const r1 = await admin.agent.patch(`${API}/posts/${p.id}`).send({ title: "New title" }).expect(200);
    expect(r1.body.data.title).toBe("New title");
    expect(r1.body.data.slug).toBe(p.slug); // stable URL
    expect(r1.body.data.excerpt).toBe("keep me");
    expect(r1.body.data.tags.map((x: any) => x.slug).sort()).toEqual(["one", "two"]);
    const r2 = await admin.agent.patch(`${API}/posts/${p.id}`).send({ tags: ["Two", "three"] }).expect(200);
    expect(r2.body.data.tags.map((x: any) => x.slug).sort()).toEqual(["three", "two"]);
    const r3 = await admin.agent.patch(`${API}/posts/${p.id}`).send({ tags: [] }).expect(200);
    expect(r3.body.data.tags).toEqual([]);
    expect(await t.db.select().from(postTag)).toHaveLength(0);
    expect((await t.db.select().from(tag)).length).toBe(3); // tags are kept for reuse
  });

  it("recomputes derived fields when content changes; auto excerpts follow, explicit ones stay", async () => {
    const auto = await createPostVia(admin.agent, { content: doc("First version of the text.") });
    const explicit = await createPostVia(admin.agent, { content: doc("Other text."), excerpt: "Hand written" });
    const long = Array.from({ length: 500 }, () => "word").join(" ");
    const a = await admin.agent.patch(`${API}/posts/${auto.id}`).send({ content: doc(long) }).expect(200);
    expect(a.body.data.excerpt).not.toBe("First version of the text.");
    expect(a.body.data.excerpt.length).toBeLessThanOrEqual(200);
    expect(a.body.data.readingMinutes).toBeGreaterThanOrEqual(3);
    const e = await admin.agent.patch(`${API}/posts/${explicit.id}`).send({ content: doc(long) }).expect(200);
    expect(e.body.data.excerpt).toBe("Hand written");
    const cleared = await admin.agent.patch(`${API}/posts/${explicit.id}`).send({ excerpt: "" }).expect(200);
    expect(cleared.body.data.excerpt.startsWith("word word")).toBe(true);
    const [row] = await t.db.select().from(post).where(eq(post.id, auto.id));
    expect(row!.contentText.startsWith("word word")).toBe(true);
  });

  it("changes the slug (409 when taken) and cover fields", async () => {
    const a = await createPostVia(admin.agent, { title: "A" });
    const b = await createPostVia(admin.agent, { title: "B" });
    await admin.agent.patch(`${API}/posts/${b.id}`).send({ slug: a.slug }).expect(409);
    const ok = await admin.agent.patch(`${API}/posts/${b.id}`).send({ slug: "renamed", coverImageUrl: "/api/media/files/x.png", coverImageAlt: "x" }).expect(200);
    expect(ok.body.data).toMatchObject({ slug: "renamed", coverImageUrl: "/api/media/files/x.png", coverImageAlt: "x" });
    const cleared = await admin.agent.patch(`${API}/posts/${b.id}`).send({ coverImageUrl: null }).expect(200);
    expect(cleared.body.data.coverImageUrl).toBeNull();
    expect(cleared.body.data.coverImageAlt).toBeNull();
    // same slug as itself is fine
    await admin.agent.patch(`${API}/posts/${b.id}`).send({ slug: "renamed" }).expect(200);
  });

  it("an empty patch is a no-op; unknown post is 404; invalid content 422", async () => {
    const p = await createPostVia(admin.agent);
    await admin.agent.patch(`${API}/posts/${p.id}`).send({}).expect(200);
    await admin.agent.patch(`${API}/posts/00000000-0000-4000-8000-000000000000`).send({ title: "x" }).expect(404);
    await admin.agent.patch(`${API}/posts/${p.id}`).send({ content: { root: { type: "root", children: [{ type: "paragraph", version: 1, children: [{ type: "image", version: 1, src: "javascript:alert(1)", altText: "", width: 0, height: 0, maxWidth: 1, showCaption: false }] }] } } }).expect(422);
  });

  it("updating a published post revalidates old and new locations and re-embeds", async () => {
    const p = await createPostVia(admin.agent, { title: "Moving", section: "personal", status: "published" });
    revalidate.mockClear();
    await admin.agent.patch(`${API}/posts/${p.id}`).send({ section: "engineering", slug: "moved" }).expect(200);
    const tags = revalidate.mock.calls.flatMap((c) => c[0]);
    expect(tags).toEqual(expect.arrayContaining(["post:moving", "post:moved", "section:personal", "section:engineering"]));
    embed.mockClear();
    await admin.agent.patch(`${API}/posts/${p.id}`).send({ content: doc("completely different body") }).expect(200);
    expect(await waitFor(async () => embed.mock.calls.length > 0)).toBe(true);
  });

  it("status via PATCH: published, draft, archived ok; scheduled rejected", async () => {
    const p = await createPostVia(admin.agent);
    const pub = await admin.agent.patch(`${API}/posts/${p.id}`).send({ status: "published" }).expect(200);
    expect(pub.body.data.status).toBe("published");
    expect(pub.body.data.publishedAt).toBeTruthy();
    const draft = await admin.agent.patch(`${API}/posts/${p.id}`).send({ status: "draft" }).expect(200);
    expect(draft.body.data.status).toBe("draft");
    expect(draft.body.data.publishedAt).toBe(pub.body.data.publishedAt);
    const arch = await admin.agent.patch(`${API}/posts/${p.id}`).send({ status: "archived" }).expect(200);
    expect(arch.body.data.status).toBe("archived");
    await admin.agent.patch(`${API}/posts/${p.id}`).send({ status: "scheduled" }).expect(422);
  });
});

describe("publish / unpublish / schedule / delete", () => {
  it("publish sets publishedAt once, revalidates, embeds; re-publish keeps the date", async () => {
    const p = await createPostVia(admin.agent, { title: "Pub", tags: ["x"] });
    const r1 = await admin.agent.post(`${API}/posts/${p.id}/publish`).expect(200);
    expect(r1.body.data.status).toBe("published");
    const publishedAt = r1.body.data.publishedAt as string;
    expect(new Date(publishedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(revalidate.mock.calls[0]![0]).toEqual(expect.arrayContaining(["posts", "post:pub", "section:engineering"]));
    expect(await waitFor(async () => (await admin.agent.get(`${API}/posts/${p.id}`)).body.data.hasEmbedding === true)).toBe(true);

    // idempotent
    const again = await admin.agent.post(`${API}/posts/${p.id}/publish`).expect(200);
    expect(again.body.data.publishedAt).toBe(publishedAt);

    // unpublish → draft, date kept
    const un = await admin.agent.post(`${API}/posts/${p.id}/unpublish`).expect(200);
    expect(un.body.data.status).toBe("draft");
    expect(un.body.data.publishedAt).toBe(publishedAt);
    // re-publish keeps the first publication date
    await new Promise((r) => setTimeout(r, 15));
    const re = await admin.agent.post(`${API}/posts/${p.id}/publish`).expect(200);
    expect(re.body.data.publishedAt).toBe(publishedAt);
    const actions = await auditActions(t);
    expect(actions).toEqual(expect.arrayContaining(["post.create", "post.publish", "post.unpublish"]));
  });

  it("unpublish revalidates the public site", async () => {
    const p = await createPostVia(admin.agent, { title: "Down", status: "published" });
    revalidate.mockClear();
    await admin.agent.post(`${API}/posts/${p.id}/unpublish`).expect(200);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.mock.calls[0]![0]).toContain("post:down");
  });

  it("publish 404s unknown ids and 422s empty content", async () => {
    await admin.agent.post(`${API}/posts/00000000-0000-4000-8000-000000000000/publish`).expect(404);
    const row = await insertPost(t, admin.user.id, { content: { root: { type: "root", children: [] } } as never });
    await admin.agent.post(`${API}/posts/${row.id}/publish`).expect(422);
  });

  it("embedding failures never fail the request", async () => {
    embed.mockRejectedValue(new Error("provider down"));
    const p = await createPostVia(admin.agent);
    await admin.agent.post(`${API}/posts/${p.id}/publish`).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    const got = await admin.agent.get(`${API}/posts/${p.id}`).expect(200);
    expect(got.body.data.hasEmbedding).toBe(false);
  });

  it("schedule: future date → scheduled; past → 422; published → 409; unpublish cancels", async () => {
    const p = await createPostVia(admin.agent);
    const when = new Date(Date.now() + 3_600_000).toISOString();
    const res = await admin.agent.post(`${API}/posts/${p.id}/schedule`).send({ scheduledFor: when }).expect(200);
    expect(res.body.data).toMatchObject({ status: "scheduled", scheduledFor: when, publishedAt: null });
    const past = await admin.agent.post(`${API}/posts/${p.id}/schedule`).send({ scheduledFor: new Date(Date.now() - 1000).toISOString() }).expect(422);
    expect(past.body.error.code).toBe("validation_error");
    await admin.agent.post(`${API}/posts/${p.id}/schedule`).send({ scheduledFor: "tomorrow" }).expect(400);
    await admin.agent.post(`${API}/posts/${p.id}/schedule`).send({}).expect(400);
    // reschedule is fine
    const when2 = new Date(Date.now() + 7_200_000).toISOString();
    await admin.agent.post(`${API}/posts/${p.id}/schedule`).send({ scheduledFor: when2 }).expect(200);
    const un = await admin.agent.post(`${API}/posts/${p.id}/unpublish`).expect(200);
    expect(un.body.data).toMatchObject({ status: "draft", scheduledFor: null });

    await admin.agent.post(`${API}/posts/${p.id}/publish`).expect(200);
    await admin.agent.post(`${API}/posts/${p.id}/schedule`).send({ scheduledFor: when }).expect(409);
  });

  it("delete removes the post, its tags links and embedding; revalidates; 404 afterwards", async () => {
    const p = await createPostVia(admin.agent, { title: "Bye", tags: ["x"], status: "published" });
    await waitFor(async () => (await t.db.select().from(postEmbedding)).length === 1);
    revalidate.mockClear();
    await admin.agent.delete(`${API}/posts/${p.id}`).expect(204);
    expect(revalidate.mock.calls[0]![0]).toContain("post:bye");
    expect(await t.db.select().from(post)).toHaveLength(0);
    expect(await t.db.select().from(postTag)).toHaveLength(0);
    expect(await t.db.select().from(postEmbedding)).toHaveLength(0);
    await admin.agent.delete(`${API}/posts/${p.id}`).expect(404);
    await admin.agent.get(`${API}/posts/${p.id}`).expect(404);
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "post.delete"));
    expect(entry).toMatchObject({ targetType: "post", targetId: p.id, actorId: admin.user.id });
  });
});

describe("editor images (data: URIs)", () => {
  it("uploads data-URI images to storage, creates media rows and rewrites the src (create + idempotent update)", async () => {
    const img = png(3, 2);
    const p = await createPostVia(admin.agent, { content: docWithImage(dataUri(img, "image/png"), "tiny") });
    const src = (p.content.root.children[1] as any).src as string;
    expect(src).toMatch(/^\/api\/media\/files\/media\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    const rows = await t.db.select().from(media);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: src, mime: "image/png", width: 3, height: 2, alt: "tiny", uploadedBy: admin.user.id, sizeBytes: img.length });
    expect(t.storage.objects.get(rows[0]!.key)!.body.equals(img)).toBe(true);
    // the stored document no longer contains the base64 payload
    const [row] = await t.db.select().from(post).where(eq(post.id, p.id));
    expect(JSON.stringify(row!.content)).not.toContain("base64");

    // re-saving the rewritten content creates nothing new
    await admin.agent.patch(`${API}/posts/${p.id}`).send({ content: p.content, title: "Renamed" }).expect(200);
    expect(await t.db.select().from(media)).toHaveLength(1);
    expect(t.storage.objects.size).toBe(1);
  });

  it("de-duplicates identical images within one document and handles several formats", async () => {
    const a = dataUri(png(1, 1), "image/png");
    const content = doc("x");
    (content.root.children as unknown[]).push(
      { type: "image", version: 1, src: a, altText: "one", width: 0, height: 0, maxWidth: 1, showCaption: false },
      { type: "image", version: 1, src: a, altText: "two", width: 0, height: 0, maxWidth: 1, showCaption: false },
    );
    const p = await createPostVia(admin.agent, { content });
    const [i1, i2] = [p.content.root.children[1], p.content.root.children[2]] as any[];
    expect(i1.src).toBe(i2.src);
    expect(await t.db.select().from(media)).toHaveLength(1);
  });

  it("a declared mime type does not matter: bytes are sniffed (png declared as jpeg is stored as png)", async () => {
    const p = await createPostVia(admin.agent, { content: docWithImage(dataUri(png(2, 2), "image/jpeg")) });
    expect((p.content.root.children[1] as any).src).toMatch(/\.png$/);
  });

  it("rejects non-image bytes behind an image data URI with 422 + details, storing nothing", async () => {
    const fake = `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    const res = await admin.agent.post(`${API}/posts`).send({ title: "x", section: "personal", content: docWithImage(fake) }).expect(422);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.details[0].message).toMatch(/Unsupported file type/);
    expect(await t.db.select().from(post)).toHaveLength(0);
    expect(await t.db.select().from(media)).toHaveLength(0);
    expect(t.storage.objects.size).toBe(0);
  });

  it("rejects svg data URIs", async () => {
    const res = await admin.agent.post(`${API}/posts`).send({ title: "x", section: "personal", content: docWithImage(dataUri(svg(), "image/svg+xml")) });
    expect(res.status).toBe(422);
    expect(t.storage.objects.size).toBe(0);
  });

  it("is all-or-nothing: one bad image removes the good ones that were already stored", async () => {
    const content = doc("x");
    const bad = `data:image/png;base64,${Buffer.from("not an image at all").toString("base64")}`;
    (content.root.children as unknown[]).push(
      { type: "image", version: 1, src: dataUri(png(4, 4), "image/png"), altText: "good", width: 0, height: 0, maxWidth: 1, showCaption: false },
      { type: "image", version: 1, src: bad, altText: "bad", width: 0, height: 0, maxWidth: 1, showCaption: false },
    );
    await admin.agent.post(`${API}/posts`).send({ title: "x", section: "personal", content }).expect(422);
    expect(t.storage.objects.size).toBe(0);
    expect(await t.db.select().from(media)).toHaveLength(0);
  });

  it("also externalises images on update, and cleans up storage when the update itself fails", async () => {
    const p = await createPostVia(admin.agent, { title: "A" });
    const other = await createPostVia(admin.agent, { title: "B" });
    await admin.agent.patch(`${API}/posts/${p.id}`).send({ content: docWithImage(dataUri(png(5, 5), "image/png")) }).expect(200);
    expect(t.storage.objects.size).toBe(1);
    // slug clash makes the transaction fail after the image was stored → the object must be removed again
    await admin.agent.patch(`${API}/posts/${other.id}`).send({ slug: p.slug, content: docWithImage(dataUri(png(6, 6), "image/png")) }).expect(409);
    expect(t.storage.objects.size).toBe(1);
    expect(await t.db.select().from(media)).toHaveLength(1);
  });
});
