import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadConfig } from "../src/config";
import { HttpError, notFound } from "../src/errors";
import { createRevalidator, postTags } from "../src/lib/revalidate";
import { bearerMatches, safeEqual } from "../src/lib/crypto";
import { parsePagination, paginated } from "../src/lib/pagination";
import { createLogger } from "../src/logger";
import { createErrorHandler, notFoundHandler } from "../src/middleware/error-handler";
import { createRateLimiters } from "../src/middleware/rate-limit";
import { DisabledProvider, EmbeddingsDisabledError, OpenAICompatibleProvider, EMBEDDING_DIMENSIONS, truncateForEmbedding } from "../src/services/embeddings";
import { ConsoleMailer, MemoryMailer, ResendMailer, createMailer, extractLinks, newsletterConfirmEmail, resetPasswordEmail, verifyEmail } from "../src/services/mailer";
import { NoopProvider } from "../src/services/newsletter";
import { LocalStorage, createStorage } from "../src/services/storage";

const silent = createLogger({ logLevel: "silent", isProd: false });
const cfg = (env: Record<string, string> = {}) => loadConfig({ NODE_ENV: "test", ...env });

describe("config", () => {
  it("applies SPEC defaults", () => {
    const c = cfg();
    expect(c).toMatchObject({
      basePath: "/api",
      port: 4000,
      siteUrl: "http://localhost:3000",
      authUrl: "http://localhost:3000",
      apiInternalUrl: "http://localhost:4000",
      databaseUrl: "postgres://blog:blog@localhost:5432/blog",
    });
    expect(c.mailer.driver).toBe("console");
    expect(c.storage.driver).toBe("local");
    expect(c.embedding).toMatchObject({ enabled: false, model: "text-embedding-3-small" });
    expect(c.listmonk.enabled).toBe(false);
    expect(c.social).toEqual({});
    expect(c.rateLimit.enabled).toBe(false); // off under NODE_ENV=test unless RATE_LIMIT_ENABLED
  });

  it("parses lists, empty values, base path and flags", () => {
    const c = cfg({ ADMIN_EMAILS: " A@x.com, b@x.com ,", API_BASE_PATH: "v2/", GOOGLE_CLIENT_ID: "", RATE_LIMIT_ENABLED: "1", EMBEDDING_API_KEY: "k", TRUSTED_ORIGINS: "https://admin.example.com/path" });
    expect(c.adminEmails).toEqual(["a@x.com", "b@x.com"]);
    expect(c.basePath).toBe("/v2");
    expect(cfg({ API_BASE_PATH: "/" }).basePath).toBe("");
    expect(c.social.google).toBeUndefined();
    expect(c.rateLimit.enabled).toBe(true);
    expect(c.embedding.enabled).toBe(true);
    expect(c.trustedOrigins).toContain("https://admin.example.com");
  });

  it("enables social providers only with both id and secret", () => {
    expect(cfg({ GITHUB_CLIENT_ID: "i" }).social.github).toBeUndefined();
    expect(cfg({ GITHUB_CLIENT_ID: "i", GITHUB_CLIENT_SECRET: "s" }).social.github).toEqual({ clientId: "i", clientSecret: "s" });
  });

  it("requires a strong secret in production and rejects bad values", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short" })).toThrow(/32/);
    expect(() => cfg({ MAILER_DRIVER: "pigeon" })).toThrow(/MAILER_DRIVER/);
    expect(loadConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(40) }).trustedOrigins).not.toContain("http://localhost:3001");
  });
});

describe("pagination", () => {
  it("parses with defaults and limits", () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 10 });
    expect(parsePagination({ page: "2", pageSize: "50" })).toEqual({ page: 2, pageSize: 50 });
    expect(() => parsePagination({ pageSize: "51" })).toThrow();
  });
  it("paginated() emits data + meta", async () => {
    const app = express();
    app.get("/x", (_req, res) => void paginated(res, { data: [1, 2], total: 41, page: 2, pageSize: 20 }));
    const res = await request(app).get("/x");
    expect(res.body).toEqual({ data: [1, 2], meta: { page: 2, pageSize: 20, total: 41, totalPages: 3 } });
  });
});

describe("error handler", () => {
  const app = express();
  app.get("/http", () => {
    throw new HttpError(409, "conflict", "slug taken", { details: { slug: "x" } });
  });
  app.get("/nf", () => {
    throw notFound("no such post");
  });
  app.get("/zod", () => {
    z.object({ a: z.string() }).parse({});
  });
  app.get("/boom", async () => {
    throw new Error("db password is hunter2");
  });
  app.use(notFoundHandler);
  const logged: unknown[] = [];
  app.use(createErrorHandler({ error: (...a: unknown[]) => logged.push(a) } as never));

  it("maps HttpError, zod and unknown errors to the envelope", async () => {
    expect((await request(app).get("/http")).body).toEqual({ error: { code: "conflict", message: "slug taken", details: { slug: "x" } } });
    expect((await request(app).get("/nf")).status).toBe(404);
    const z400 = await request(app).get("/zod");
    expect(z400.status).toBe(400);
    expect(z400.body.error.code).toBe("validation_error");
    expect(z400.body.error.details[0].path).toEqual(["a"]);
  });
  it("never leaks unknown error messages (async handlers included)", async () => {
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "internal", message: "Internal server error" } });
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe("rate limiting", () => {
  it("returns the rate_limited envelope with Retry-After once the preset is exceeded", async () => {
    const limiters = createRateLimiters({ rateLimit: { enabled: true } });
    const app = express();
    app.set("trust proxy", 1);
    app.post("/subscribe", limiters.subscribe, (_req, res) => void res.status(202).end());
    app.use(createErrorHandler(silent));
    for (let i = 0; i < 5; i++) await request(app).post("/subscribe").expect(202);
    const res = await request(app).post("/subscribe").expect(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(res.headers["retry-after"]).toBeTruthy();
    // a different client IP has its own budget
    await request(app).post("/subscribe").set("X-Forwarded-For", "203.0.113.9").expect(202);
  });
  it("is a no-op when disabled", async () => {
    const limiters = createRateLimiters({ rateLimit: { enabled: false } });
    const app = express();
    app.post("/s", limiters.subscribe, (_req, res) => void res.status(202).end());
    for (let i = 0; i < 20; i++) await request(app).post("/s").expect(202);
  });
});

describe("mailer", () => {
  it("memory mailer captures and finds links", async () => {
    const m = new MemoryMailer();
    const r = verifyEmail({ siteName: "Site", name: "<b>Eve</b>", url: "https://x.test/api/auth/verify-email?token=abc&callbackURL=%2F" });
    await m.send({ to: "Eve@X.test", ...r });
    expect(m.last("eve@x.test")?.subject).toContain("Site");
    expect(extractLinks(m.outbox[0]!)[0]).toBe("https://x.test/api/auth/verify-email?token=abc&callbackURL=%2F");
    expect(r.html).not.toContain("<b>Eve</b>"); // escaped
    expect(r.html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    m.failWith = new Error("down");
    await expect(m.send({ to: "a@b.c", ...r })).rejects.toThrow("down");
  });

  it("templates produce subject, html and text", () => {
    for (const r of [
      resetPasswordEmail({ siteName: "S", name: "N", url: "https://x.test/r" }),
      newsletterConfirmEmail({ siteName: "S", url: "https://x.test/c?token=1", unsubscribeUrl: "https://x.test/u" }),
    ]) {
      expect(r.subject).toBeTruthy();
      expect(r.html).toContain("https://x.test/");
      expect(r.text).toContain("https://x.test/");
    }
  });

  it("resend driver posts to the Resend API with a bearer key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await new ResendMailer("re_key", "Me <me@x.test>", fetchMock).send({ to: "a@b.test", subject: "S", html: "<p>h</p>", text: "t" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ from: "Me <me@x.test>", to: ["a@b.test"], subject: "S" });
    const failing = (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch;
    await expect(new ResendMailer("k", "f", failing).send({ to: "a@b.test", subject: "S", html: "", text: "" })).rejects.toThrow(/422/);
  });

  it("createMailer picks a driver and degrades to console when misconfigured", () => {
    expect(createMailer(cfg(), silent)).toBeInstanceOf(ConsoleMailer);
    expect(createMailer(cfg({ MAILER_DRIVER: "smtp" }), silent)).toBeInstanceOf(ConsoleMailer);
    expect(createMailer(cfg({ MAILER_DRIVER: "resend" }), silent)).toBeInstanceOf(ConsoleMailer);
    expect(createMailer(cfg({ MAILER_DRIVER: "resend", RESEND_API_KEY: "k" }), silent).driver).toBe("resend");
    expect(createMailer(cfg({ MAILER_DRIVER: "smtp", SMTP_URL: "smtp://localhost:1025" }), silent).driver).toBe("smtp");
  });
});

describe("storage", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("local driver stores, serves, deletes and rejects traversal", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "blog-storage-"));
    dirs.push(dir);
    const s = new LocalStorage(dir, "/api/media/files");
    const stored = await s.put("2026/abc123.png", Buffer.from([1, 2, 3]), { contentType: "image/png" });
    expect(stored).toEqual({ key: "2026/abc123.png", url: "/api/media/files/2026/abc123.png" });
    const obj = await s.open("2026/abc123.png");
    expect(obj).toMatchObject({ size: 3, contentType: "image/png" });
    obj!.stream.destroy();
    await s.delete("2026/abc123.png");
    expect(await s.open("2026/abc123.png")).toBeNull();
    await expect(s.put("../evil.png", Buffer.alloc(1), { contentType: "image/png" })).rejects.toThrow(/Unsafe/);
    await expect(s.put("/etc/passwd", Buffer.alloc(1), { contentType: "image/png" })).rejects.toThrow(/Unsafe/);
    expect(await s.open("../../etc/passwd")).toBeNull();
    await s.delete("never-existed.png"); // not an error
  });

  it("createStorage defaults to local and falls back when the blob token is missing", () => {
    expect(createStorage(cfg(), silent).driver).toBe("local");
    const prev = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(createStorage(cfg({ STORAGE_DRIVER: "vercel-blob" }), silent).driver).toBe("local");
    expect(createStorage(cfg({ STORAGE_DRIVER: "vercel-blob", BLOB_READ_WRITE_TOKEN: "tok" }), silent).driver).toBe("vercel-blob");
    if (prev) process.env.BLOB_READ_WRITE_TOKEN = prev;
  });
});

describe("embeddings", () => {
  const vec = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);

  it("disabled provider rejects", async () => {
    const p = new DisabledProvider();
    expect(p.enabled).toBe(false);
    await expect(p.embed(["x"])).rejects.toBeInstanceOf(EmbeddingsDisabledError);
  });

  it("openai-compatible: batches, orders by index, truncates input, sends dimensions for -3 models", async () => {
    const bodies: { input: string[]; model: string; dimensions?: number }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://emb.test/v1/embeddings");
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      // return out of order to prove sorting by index
      const data = body.input.map((_: string, index: number) => ({ index, embedding: vec() })).reverse();
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ url: "https://emb.test/v1", apiKey: "k", model: "text-embedding-3-small", fetch: fetchMock, batchSize: 2 });
    const out = await p.embed(["a", "b", "c".repeat(100_000)]);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(bodies[1]!.input[0]!.length).toBeLessThan(30_000);
    expect(truncateForEmbedding("  a   b \n c ")).toBe("a b c");
  });

  it("rejects wrong dimensions and retries 5xx", async () => {
    const wrong = (async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(new OpenAICompatibleProvider({ url: "https://e.test/embeddings", apiKey: "k", model: "m", fetch: wrong }).embed(["x"])).rejects.toThrow(/dimensions/);
    let n = 0;
    const flaky = (async () => (++n < 2 ? new Response("", { status: 503 }) : new Response(JSON.stringify({ data: [{ embedding: vec() }] }), { status: 200 }))) as unknown as typeof fetch;
    const out = await new OpenAICompatibleProvider({ url: "https://e.test", apiKey: "k", model: "other-model", fetch: flaky }).embed(["x"]);
    expect(out).toHaveLength(1);
    expect(n).toBe(2);
  });
});

describe("revalidate + newsletter noop + crypto", () => {
  it("revalidator posts deduped tags with the secret, and never throws", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const c = cfg({ WEB_REVALIDATE_URL: "http://web.test/internal/revalidate", REVALIDATE_SECRET: "s3cret" });
    await createRevalidator(c, silent, ok)(["posts", "posts", "post:a"]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ tags: ["posts", "post:a"] });
    expect((calls[0]!.init.headers as Record<string, string>)["x-revalidate-secret"]).toBe("s3cret");
    const boom = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(createRevalidator(c, silent, boom)(["posts"])).resolves.toBeUndefined();
    await createRevalidator(cfg(), silent, ok)(["posts"]); // unset URL → no call
    expect(calls).toHaveLength(1);
    expect(postTags({ slug: "a", section: "personal" })).toEqual(["posts", "post:a", "section:personal"]);
  });

  it("noop newsletter provider satisfies the interface", async () => {
    const n = new NoopProvider();
    expect(await n.upsertSubscriber("a@b.c")).toEqual({ externalId: "noop" });
    await n.removeSubscriber("a@b.c");
    expect((await n.sendCampaign({ subject: "s", html: "h", name: "n" })).campaignId).toBe("noop");
    await n.testCampaign({ html: "h", subject: "s", to: "a@b.c" });
    expect(await n.campaignStats("noop")).toMatchObject({ sent: 0 });
  });

  it("constant-time helpers", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer nope", "s3cret")).toBe(false);
    expect(bearerMatches(undefined, "s3cret")).toBe(false);
    expect(bearerMatches("Bearer anything", undefined)).toBe(false);
  });
});
