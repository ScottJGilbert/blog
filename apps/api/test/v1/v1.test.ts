import { apiKey, comment, eq } from "@blog/db";
import { PostDetailSchema, PostSummarySchema, SearchResultSchema, TagWithCountSchema, V1CommentSchema } from "@blog/shared";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, createUser, type TestApp } from "../helpers";
import { adminSession, insertComment, insertPost, doc, type Admin } from "../admin/helpers";
import { V1_PATHS, buildOpenApiDocument } from "../../src/routes/v1/openapi";
import { API_KEY_FORMAT } from "../../src/services/admin/api-keys";
import { LAST_USED_THROTTLE_MS } from "../../src/routes/v1/api-key-auth";

let t: TestApp;
let admin: Admin;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  admin = await adminSession(t);
});

const V1 = "/api/v1";
const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

async function newKey(scopes: string[] = [], name = "k") {
  const res = await admin.agent.post("/api/admin/api-keys").send({ name, scopes }).expect(201);
  return res.body.data as { id: string; key: string };
}

async function publish(o: Partial<Parameters<typeof insertPost>[2]> = {}) {
  return insertPost(t, admin.user.id, { status: "published", publishedAt: new Date(Date.now() - 60_000), ...o });
}

describe("public reads", () => {
  it("lists published posts only, validated against the shared schema, with caching headers", async () => {
    await publish({ slug: "a", title: "Alpha" });
    await publish({ slug: "b", title: "Beta", section: "personal" });
    await insertPost(t, admin.user.id, { slug: "draft", status: "draft" });
    await insertPost(t, admin.user.id, { slug: "future", status: "published", publishedAt: new Date(Date.now() + 1e7) });
    const res = await request(t.app).get(`${V1}/posts`).expect(200);
    expect(res.headers["cache-control"]).toBe(CACHE);
    expect(res.headers.etag).toBeTruthy();
    expect(res.body.meta).toEqual({ page: 1, pageSize: 10, total: 2, totalPages: 1 });
    expect(res.body.data.map((p: any) => p.slug)).toEqual(["b", "a"]);
    for (const p of res.body.data) {
      PostSummarySchema.parse(p);
      expect(p.content).toBeUndefined();
    }
    expect((await request(t.app).get(`${V1}/posts?section=personal`)).body.data.map((p: any) => p.slug)).toEqual(["b"]);
    expect((await request(t.app).get(`${V1}/posts?sort=oldest`)).body.data.map((p: any) => p.slug)).toEqual(["a", "b"]);
    expect((await request(t.app).get(`${V1}/posts?pageSize=1&page=2`)).body.meta).toMatchObject({ page: 2, total: 2, totalPages: 2 });
    await request(t.app).get("/v1/posts").expect(200); // unprefixed mount
  });

  it("returns a post with Lexical content, rendered HTML, toc and neighbours", async () => {
    await publish({ slug: "older", publishedAt: new Date(Date.now() - 200_000) });
    await publish({ slug: "mid", title: "Middle", content: doc("Middle body") as never });
    await publish({ slug: "newer", publishedAt: new Date(Date.now() - 1000) });
    const res = await request(t.app).get(`${V1}/posts/mid`).expect(200);
    const p = PostDetailSchema.parse(res.body.data);
    expect(p.contentHtml).toContain("Middle body");
    expect(p.content.root.children).toHaveLength(1);
    expect(p.prev?.slug).toBe("older");
    expect(p.next?.slug).toBe("newer");
    expect(res.headers["cache-control"]).toBe(CACHE);
  });

  it("404s unknown, draft and future slugs with the error envelope (not cacheable)", async () => {
    await insertPost(t, admin.user.id, { slug: "draft", status: "draft" });
    for (const slug of ["nope", "draft", "x".repeat(300)]) {
      const res = await request(t.app).get(`${V1}/posts/${slug}`).expect(404);
      expect(res.body.error.code).toBe("not_found");
      expect(res.headers["cache-control"]).not.toBe(CACHE);
    }
  });

  it("lists tags with counts and searches", async () => {
    const { post: postTable, tag, postTag } = await import("@blog/db");
    void postTable;
    const p = await publish({ slug: "searchable", title: "Quantum widgets explained", contentText: "Quantum widgets are great", excerpt: "about quantum" });
    const [tg] = await t.db.insert(tag).values({ slug: "physics", name: "Physics" }).returning();
    await t.db.insert(postTag).values({ postId: p.id, tagId: tg!.id });
    const tags = await request(t.app).get(`${V1}/tags`).expect(200);
    expect(tags.body.data).toEqual([{ slug: "physics", name: "Physics", count: 1 }]);
    z.array(TagWithCountSchema).parse(tags.body.data);
    expect(tags.headers["cache-control"]).toBe(CACHE);

    const s = await request(t.app).get(`${V1}/search?q=quantum`).expect(200);
    expect(s.body.data).toHaveLength(1);
    SearchResultSchema.parse(s.body.data[0]);
    expect(s.body.data[0].snippet).toContain("<mark>");
    expect(s.headers["cache-control"]).toBe(CACHE);
    expect((await request(t.app).get(`${V1}/posts?tag=physics`)).body.meta.total).toBe(1);
  });

  it("validates strictly: unknown params, bad ranges and short queries are 400", async () => {
    for (const url of [`${V1}/posts?foo=1`, `${V1}/posts?pageSize=51`, `${V1}/posts?page=0`, `${V1}/posts?section=x`, `${V1}/posts?sort=random`, `${V1}/search`, `${V1}/search?q=a`, `${V1}/search?q=ab&extra=1`]) {
      const res = await request(t.app).get(url);
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
    }
  });

  it("is read-only: non-GET methods are 405", async () => {
    for (const m of ["post", "put", "patch", "delete"] as const) {
      const res = await request(t.app)[m](`${V1}/posts`).send({}).expect(405);
      expect(res.headers.allow).toBe("GET, HEAD, OPTIONS");
    }
  });
});

describe("ETag / conditional requests", () => {
  it("answers If-None-Match with 304 and changes the ETag when data changes", async () => {
    await publish({ slug: "etag", title: "ETag post" });
    for (const url of [`${V1}/posts`, `${V1}/posts/etag`, `${V1}/tags`, `${V1}/openapi.json`]) {
      const first = await request(t.app).get(url).expect(200);
      const etag = first.headers.etag!;
      expect(etag, url).toBeTruthy();
      const cond = await request(t.app).get(url).set("If-None-Match", etag).expect(304);
      expect(cond.text).toBe("");
      expect(cond.headers["cache-control"]).toBe(CACHE);
      await request(t.app).get(url).set("If-None-Match", '"other"').expect(200);
    }
    const before = (await request(t.app).get(`${V1}/posts/etag`)).headers.etag;
    const { post } = await import("@blog/db");
    await t.db.update(post).set({ title: "Changed title" }).where(eq(post.slug, "etag"));
    const after = (await request(t.app).get(`${V1}/posts/etag`)).headers.etag;
    expect(after).not.toBe(before);
  });
});

describe("CORS", () => {
  it("allows any origin for GET, no credentials, preflight limited to GET", async () => {
    const res = await request(t.app).get(`${V1}/tags`).set("Origin", "https://third-party.example").expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    const pre = await request(t.app)
      .options(`${V1}/posts`)
      .set("Origin", "https://third-party.example")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,x-api-key");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-methods"]).toBe("GET,HEAD,OPTIONS");
    expect(pre.headers["access-control-allow-headers"]).toMatch(/x-api-key/i);
  });
});

describe("API keys", () => {
  it("no key is anonymous; a malformed, unknown or revoked key is 401", async () => {
    await request(t.app).get(`${V1}/tags`).expect(200);
    const unknown = `blg_${"A".repeat(43)}`;
    for (const h of [
      { "x-api-key": "garbage" },
      { "x-api-key": unknown },
      { authorization: `Bearer ${unknown}` },
      { authorization: "Bearer blg_short" },
    ]) {
      const res = await request(t.app).get(`${V1}/tags`).set(h);
      expect(res.status, JSON.stringify(h)).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
    }
    const k = await newKey(["posts:read"]);
    await request(t.app).get(`${V1}/tags`).set("x-api-key", k.key).expect(200);
    await admin.agent.delete(`/api/admin/api-keys/${k.id}`).expect(204);
    await request(t.app).get(`${V1}/tags`).set("x-api-key", k.key).expect(401);
    await request(t.app).get(`${V1}/tags`).set("authorization", `Bearer ${k.key}`).expect(401);
  });

  it("accepts the key as Bearer token or x-api-key and records last_used_at (throttled)", async () => {
    const k = await newKey(["posts:read"]);
    expect(k.key).toMatch(API_KEY_FORMAT);
    const row = async () => (await t.db.select().from(apiKey).where(eq(apiKey.id, k.id)))[0]!;
    expect((await row()).lastUsedAt).toBeNull();
    await request(t.app).get(`${V1}/tags`).set("authorization", `Bearer ${k.key}`).expect(200);
    const first = (await row()).lastUsedAt!;
    expect(first).toBeTruthy();
    await request(t.app).get(`${V1}/tags`).set("x-api-key", k.key).expect(200);
    expect((await row()).lastUsedAt!.getTime()).toBe(first.getTime()); // inside the throttle window: not rewritten
    await t.db.update(apiKey).set({ lastUsedAt: new Date(Date.now() - LAST_USED_THROTTLE_MS - 5000) }).where(eq(apiKey.id, k.id));
    await request(t.app).get(`${V1}/tags`).set("x-api-key", k.key).expect(200);
    expect(Date.now() - (await row()).lastUsedAt!.getTime()).toBeLessThan(10_000);
  });

  it("a non-key Authorization header (e.g. someone else's bearer token) is ignored", async () => {
    await request(t.app).get(`${V1}/tags`).set("authorization", "Bearer some-jwt-token").expect(200);
  });

  it("session cookies never authenticate /v1 (a cookie-less public API)", async () => {
    await admin.agent.get(`${V1}/comments?postSlug=x`).expect(401);
  });
});

describe("comments (scope comments:read)", () => {
  async function thread() {
    const author = await createUser(t, { name: "Alice" });
    const p = await publish({ slug: "talk" });
    const top = await insertComment(t, p.id, author.id, { body: "top comment", createdAt: new Date(Date.now() - 5000) });
    await insertComment(t, p.id, author.id, { body: "reply 2", parentId: top.id, createdAt: new Date(Date.now() - 2000) });
    await insertComment(t, p.id, null, { body: "reply 1", parentId: top.id, createdAt: new Date(Date.now() - 3000) });
    await insertComment(t, p.id, author.id, { body: "hidden reply", parentId: top.id, status: "hidden" });
    await insertComment(t, p.id, author.id, { body: "hidden top", status: "hidden" });
    const gone = await insertComment(t, p.id, author.id, { body: "secret words", status: "deleted", createdAt: new Date(Date.now() - 9000) });
    await insertComment(t, p.id, author.id, { body: "reply to deleted", parentId: gone.id });
    await insertComment(t, p.id, author.id, { body: "deleted without replies", status: "deleted" });
    return { p, top };
  }

  it("requires a key (401) with the scope (403)", async () => {
    await thread();
    await request(t.app).get(`${V1}/comments?postSlug=talk`).expect(401);
    const wrong = await newKey(["posts:read", "tags:read"]);
    const res = await request(t.app).get(`${V1}/comments?postSlug=talk`).set("x-api-key", wrong.key).expect(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("returns visible comments, newest first, replies oldest first; deleted parents keep their visible replies", async () => {
    await thread();
    const k = await newKey(["comments:read"]);
    const res = await request(t.app).get(`${V1}/comments?postSlug=talk`).set("authorization", `Bearer ${k.key}`).expect(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=60");
    expect(res.headers.vary).toMatch(/Authorization/i);
    expect(res.body.meta).toMatchObject({ total: 2 });
    for (const c of res.body.data) V1CommentSchema.parse(c);
    const [first, second] = res.body.data;
    expect(first.body).toBe("top comment");
    expect(first.author).toEqual({ name: "Alice", image: null });
    expect(first.replies.map((r: any) => r.body)).toEqual(["reply 1", "reply 2"]);
    expect(first.replies[0].author.name).toBe("Deleted user");
    expect(second.body).toBe("[deleted]");
    expect(second.author).toEqual({ name: "Deleted user", image: null });
    expect(second.replies.map((r: any) => r.body)).toEqual(["reply to deleted"]);
    expect(JSON.stringify(res.body)).not.toMatch(/secret words|hidden/);
  });

  it("paginates, 404s unknown/unpublished posts, 400s a missing postSlug", async () => {
    await thread();
    await insertPost(t, admin.user.id, { slug: "unpub", status: "draft" });
    const k = await newKey(["comments:read"]);
    const get = (q: string) => request(t.app).get(`${V1}/comments${q}`).set("x-api-key", k.key);
    expect((await get("?postSlug=talk&pageSize=1&page=2").expect(200)).body.data[0].body).toBe("[deleted]");
    await get("?postSlug=missing").expect(404);
    await get("?postSlug=unpub").expect(404);
    await get("").expect(400);
    await get("?postSlug=talk&x=1").expect(400);
  });
});

describe("rate limit headers", () => {
  it("exposes X-RateLimit-* and gives keys a higher limit", async () => {
    const limited = await buildTestApp({ env: { RATE_LIMIT_ENABLED: "1" } });
    try {
      const a = await adminSession(limited);
      const created = (await a.agent.post("/api/admin/api-keys").send({ name: "k", scopes: [] }).expect(201)).body.data;
      const anon = await request(limited.app).get(`${V1}/tags`).expect(200);
      expect(anon.headers["x-ratelimit-limit"]).toBe("120");
      expect(Number(anon.headers["x-ratelimit-remaining"])).toBe(119);
      expect(Number(anon.headers["x-ratelimit-reset"])).toBeGreaterThan(Date.now() / 1000 - 5);
      const keyed = await request(limited.app).get(`${V1}/tags`).set("x-api-key", created.key).expect(200);
      expect(keyed.headers["x-ratelimit-limit"]).toBe("1200");
      const second = await request(limited.app).get(`${V1}/tags`).expect(200);
      expect(Number(second.headers["x-ratelimit-remaining"])).toBe(118);
      expect(anon.headers["access-control-expose-headers"]).toMatch(/X-RateLimit-Limit/);
    } finally {
      await limited.close();
    }
  });

  it("answers 429 with the envelope once the anonymous budget is spent", async () => {
    const limited = await buildTestApp({ env: { RATE_LIMIT_ENABLED: "1" } });
    try {
      for (let i = 0; i < 120; i++) await request(limited.app).get(`${V1}/tags`).expect(200);
      const res = await request(limited.app).get(`${V1}/tags`).expect(429);
      expect(res.body.error.code).toBe("rate_limited");
      expect(res.headers["retry-after"]).toBeTruthy();
    } finally {
      await limited.close();
    }
  }, 60_000);
});

describe("OpenAPI document", () => {
  it("is valid OpenAPI 3.1 JSON with a resolvable $ref graph and security schemes", async () => {
    const res = await request(t.app).get(`${V1}/openapi.json`).expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const doc = res.body;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toMatchObject({ title: expect.any(String), version: "1" });
    expect(doc.servers[0].url).toBe("http://localhost:3000/api");
    expect(Object.keys(doc.paths).sort()).toEqual([...V1_PATHS].sort());
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(["apiKeyHeader", "bearerAuth"]);
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([A-Za-z]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(5);
    for (const name of refs) expect(doc.components.schemas[name], name).toBeTruthy();
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      expect(Object.keys(item), path).toEqual(["get"]);
      expect(item.get.operationId).toBeTruthy();
      expect(item.get.responses["200"], path).toBeTruthy();
      const declared = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const params = (item.get.parameters ?? []).filter((p: any) => p.in === "path").map((p: any) => p.name);
      expect(params.sort(), path).toEqual(declared.sort());
    }
    expect(JSON.stringify(doc)).not.toContain("$schema");
    expect(buildOpenApiDocument(t.config)).toEqual(doc);
  });

  it("documents the query parameters the API actually accepts and every path really exists", async () => {
    const author = await createUser(t, {});
    const p = await publish({ slug: "doc-post", title: "Doc post", contentText: "Doc post body text", excerpt: "doc post" });
    await insertComment(t, p.id, author.id);
    const k = await newKey(["comments:read"]);
    const doc = (await request(t.app).get(`${V1}/openapi.json`)).body;
    const schemas = doc.components.schemas as Record<string, any>;
    const validators = Object.fromEntries(Object.entries(schemas).map(([n, s]) => [n, z.fromJSONSchema(s)]));

    for (const path of Object.keys(doc.paths)) {
      const op = doc.paths[path].get;
      const query: Record<string, string> = {};
      for (const prm of op.parameters ?? []) if (prm.in === "query" && prm.required) query[prm.name] = prm.name === "postSlug" ? "doc-post" : "doc";
      // every documented query parameter is accepted by the strict validator
      const all: Record<string, string> = { ...query };
      for (const prm of op.parameters ?? []) {
        if (prm.in !== "query" || all[prm.name]) continue;
        all[prm.name] = prm.schema.enum ? String(prm.schema.enum[0]) : prm.schema.type === "integer" ? "1" : "doc";
      }
      const url = path.replace("{slug}", "doc-post");
      const secured = op.security?.every((s: object) => Object.keys(s).length > 0);
      const req = request(t.app).get(`/api${url}`).query(all);
      const res = await (secured ? req.set("x-api-key", k.key) : req);
      expect(res.status, `${path} ${JSON.stringify(all)} ${res.text.slice(0, 200)}`).toBe(200);
      if (path.endsWith("openapi.json")) continue;
      // …and the response body satisfies the documented schema (JSON schema generated from the same zod types)
      const ok200 = op.responses["200"].content["application/json"].schema;
      const body = res.body;
      const check = (schemaNode: any, value: unknown) => {
        if (schemaNode.$ref) return validators[schemaNode.$ref.split("/").pop()]!.parse(value);
        if (schemaNode.type === "array") return (value as unknown[]).forEach((v) => check(schemaNode.items, v));
        if (schemaNode.type === "object") for (const [key, sub] of Object.entries<any>(schemaNode.properties ?? {})) check(sub, (value as any)[key]);
      };
      check(ok200, body);
      for (const key of ok200.required ?? []) expect(body[key], `${path} ${key}`).toBeDefined();
    }
    void comment;
  });
});
