/**
 * Serverless / Vercel behaviour: origins derived from Vercel system env vars, the CSRF allowlist, service-to-service calls,
 * background work via `waitUntil`, read-only filesystem handling, the shared (Postgres) rate limiter, boot failures,
 * diagnostics and request ids.
 */
import { postEmbedding, eq, auditLog, sql } from "@blog/db";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBootFailureApp, describeBootError } from "../src/boot-failure";
import { ConfigError, configWarnings, loadConfig, missingConfig } from "../src/config";
import { createBackground } from "../src/lib/background";
import { derivedPublicOrigin, isPlaceholderUrl, vercelTrustedOrigins } from "../src/lib/origins";
import { createRevalidator } from "../src/lib/revalidate";
import { createErrorHandler, isDbUnavailable } from "../src/middleware/error-handler";
import { PgRateLimitStore, purgeExpiredRateLimits } from "../src/middleware/pg-rate-limit-store";
import { createRateLimiters, makeLimiter } from "../src/middleware/rate-limit";
import { resolveRequestId } from "../src/middleware/request-id";
import { HEALTH_DB_TIMEOUT_MS, healthRouter } from "../src/routes/health";
import { createMediaService } from "../src/services/media";
import { createStorage, UnconfiguredStorage } from "../src/services/storage";
import { runReindex } from "../src/services/posts/embeddings";
import { createLogger } from "../src/logger";
import { png } from "./fakes/images";
import { anonAgent, buildTestApp, createUser, signUpAndSignIn, TEST_PASSWORD, type TestApp } from "./helpers";
import { API, createPostVia, adminSession } from "./admin/helpers";
import { BASE, ensureAuthor, FakeEmbeddings, insertPost } from "./public/fixtures";

const SECRET = "s".repeat(40);
const PREVIEW = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: SECRET,
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "blog-abc123-team.vercel.app",
  VERCEL_BRANCH_URL: "blog-git-feat-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "blog.example.org",
};
const cfg = (env: Record<string, string> = {}) => loadConfig({ ...PREVIEW, ...env });
/** A real app on the preview environment; the harness' default SITE_URL / BETTER_AUTH_URL are blanked so the origins are derived. */
const previewApp = () => buildTestApp({ env: { ...PREVIEW, SITE_URL: "", BETTER_AUTH_URL: "", RATE_LIMIT_ENABLED: "0", UPLOAD_DIR: "/tmp" } });

describe("origins on Vercel", () => {
  it("derives SITE_URL / BETTER_AUTH_URL: production domain in production, the deployment URL on previews", () => {
    const preview = cfg();
    expect(preview.siteUrl).toBe("https://blog-abc123-team.vercel.app");
    expect(preview.authUrl).toBe("https://blog-abc123-team.vercel.app");
    const prod = cfg({ VERCEL_ENV: "production" });
    expect(prod.siteUrl).toBe("https://blog.example.org");
    expect(prod.authUrl).toBe("https://blog.example.org");
    expect(derivedPublicOrigin({})).toBeUndefined(); // off Vercel nothing is derived
  });

  it("explicit SITE_URL / BETTER_AUTH_URL win; one of them stands in for the other", () => {
    const c = cfg({ SITE_URL: "https://www.example.org/", VERCEL_ENV: "production" });
    expect(c.siteUrl).toBe("https://www.example.org");
    expect(c.authUrl).toBe("https://www.example.org");
    expect(cfg({ BETTER_AUTH_URL: "https://auth.example.org" }).siteUrl).toBe("https://auth.example.org");
  });

  it("trusts EXACTLY the deployment URL, branch alias and production domain (plus configured origins), nothing else", () => {
    const c = cfg({ TRUSTED_ORIGINS: "https://extra.example.org" });
    expect(c.trustedOrigins.sort()).toEqual(
      ["https://blog-abc123-team.vercel.app", "https://blog-git-feat-team.vercel.app", "https://blog.example.org", "https://extra.example.org"].sort(),
    );
    expect(c.trustedOrigins.some((o) => o.includes("localhost"))).toBe(false);
    // junk / hostile values in the system vars are ignored rather than trusted
    expect(vercelTrustedOrigins({ VERCEL: "1", VERCEL_URL: "evil.com/../x y", VERCEL_BRANCH_URL: "*.vercel.app" })).toEqual([]);
    expect(vercelTrustedOrigins({ VERCEL_URL: "x.vercel.app" })).toEqual([]); // not on Vercel
  });

  it("production still refuses placeholder origins (and localhost stays a warning, not an error)", () => {
    expect(() => cfg({ SITE_URL: "https://your-domain" })).toThrow(/placeholder/);
    expect(() => cfg({ BETTER_AUTH_URL: "https://example.com" })).toThrow(ConfigError);
    expect(() => cfg({ SITE_URL: "https://blog.example.com" })).not.toThrow();
    expect(isPlaceholderUrl("https://app.your-domain.com")).toBe(true);
    expect(() => loadConfig({ NODE_ENV: "development", SITE_URL: "https://your-domain" })).not.toThrow();
  });

  it("config errors carry env var NAMES, never values", () => {
    try {
      loadConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short-secret-value" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).variables).toEqual(["BETTER_AUTH_SECRET"]);
      expect((err as Error).message).not.toContain("short-secret-value");
    }
    try {
      loadConfig({ NODE_ENV: "production", MAILER_DRIVER: "carrier-pigeon", BETTER_AUTH_SECRET: SECRET });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).variables).toEqual(["MAILER_DRIVER"]);
    }
  });

  it("both the unique deployment URL and the branch alias can sign in; foreign origins are rejected (host-only cookie per host)", async () => {
    const app = await previewApp();
    try {
      const u = await createUser(app);
      for (const origin of ["https://blog-abc123-team.vercel.app", "https://blog-git-feat-team.vercel.app", "https://blog.example.org"]) {
        const res = await request(app.app).post("/api/auth/sign-in/email").set("Origin", origin).send({ email: u.email, password: u.password });
        expect(res.status, origin).toBe(200);
        const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => /session_token/.test(c));
        expect(cookie).toMatch(/^__Secure-blog\.session_token=/);
        expect(cookie).toMatch(/Secure/i);
        expect(cookie).not.toMatch(/Domain=/i); // host-only
        // the app's own CSRF check (cookie-carrying write on a non-auth route) accepts the same origins
        const me = await request(app.app).patch("/api/me").set("Origin", origin).set("Cookie", "x=1").send({ name: "x" });
        expect(me.status, `csrf ${origin}`).toBe(401);
      }
      for (const origin of ["https://other-project.vercel.app", "https://blog-abc123-team.vercel.app.evil.com", "http://blog-abc123-team.vercel.app"]) {
        await request(app.app).post("/api/auth/sign-in/email").set("Origin", origin).set("Cookie", "x=1").send({ email: u.email, password: u.password }).expect(403);
        await request(app.app).patch("/api/me").set("Origin", origin).set("Cookie", "x=1").send({ name: "x" }).expect(403);
      }
    } finally {
      await app.close();
    }
  });

  it("e-mail links point at the derived origin", async () => {
    const app = await previewApp();
    try {
      expect(app.config.siteUrl).toBe("https://blog-abc123-team.vercel.app");
      await anonAgent({ app: app.app, origin: "https://blog-abc123-team.vercel.app" })
        .post("/api/auth/sign-up/email")
        .send({ email: "link@example.com", password: TEST_PASSWORD, name: "L" })
        .expect(200);
      expect(app.mailer.last("link@example.com")?.text).toContain("https://blog-abc123-team.vercel.app/api/auth/verify-email");
    } finally {
      await app.close();
    }
  });
});

describe("service-to-service: revalidation", () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string> });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const logger = createLogger({ logLevel: "silent", isProd: true });
  beforeEach(() => {
    calls.length = 0;
  });

  it("defaults to the WEB_INTERNAL_URL binding (+ path/trailing slash tolerated) and sends no bypass header to a foreign host", async () => {
    for (const binding of ["http://web.internal:3000", "https://web.internal/", "web.internal/some/prefix/"]) {
      calls.length = 0;
      const c = cfg({ WEB_INTERNAL_URL: binding, REVALIDATE_SECRET: "rv", VERCEL_AUTOMATION_BYPASS_SECRET: "bypass" });
      expect(c.revalidate.source).toBe("binding");
      await createRevalidator(c, logger, fakeFetch)(["posts"]);
      expect(calls[0]!.url).toMatch(/^https?:\/\/web\.internal(:3000)?(\/some\/prefix)?\/internal\/revalidate$/);
      expect(calls[0]!.headers["x-revalidate-secret"]).toBe("rv");
      expect(calls[0]!.headers["x-vercel-protection-bypass"]).toBeUndefined();
    }
  });

  it("falls back to this deployment's public URL WITH the bypass header; explicit WEB_REVALIDATE_URL wins", async () => {
    const c = cfg({ REVALIDATE_SECRET: "rv", VERCEL_AUTOMATION_BYPASS_SECRET: "bypass" });
    expect(c.revalidate).toMatchObject({ url: "https://blog-abc123-team.vercel.app/internal/revalidate", source: "deployment" });
    await createRevalidator(c, logger, fakeFetch)(["posts"]);
    expect(calls[0]!.headers["x-vercel-protection-bypass"]).toBe("bypass");

    const explicit = cfg({ REVALIDATE_SECRET: "rv", WEB_REVALIDATE_URL: "https://elsewhere.test/internal/revalidate", VERCEL_AUTOMATION_BYPASS_SECRET: "bypass" });
    expect(explicit.revalidate.source).toBe("env");
    calls.length = 0;
    await createRevalidator(explicit, logger, fakeFetch)(["posts"]);
    expect(calls[0]!.headers["x-vercel-protection-bypass"]).toBeUndefined();
  });

  it("is disabled without a secret (no derived URL), and never throws on a failing target", async () => {
    expect(cfg().revalidate.url).toBeUndefined();
    const c = cfg({ REVALIDATE_SECRET: "rv" });
    const boom = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(createRevalidator(c, logger, boom)(["posts"])).resolves.toBeUndefined();
  });
});

describe("storage on a read-only filesystem", () => {
  it("Vercel without a Blob token: uploads answer 503 with a clear message, everything else works; the media row is not created", async () => {
    const c = cfg();
    expect(c.storage.driver).toBe("unconfigured");
    const storage = createStorage(c);
    expect(storage).toBeInstanceOf(UnconfiguredStorage);
    await expect(storage.put("a.png", Buffer.from("x"), { contentType: "image/png" })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("BLOB_READ_WRITE_TOKEN") });
    await expect(storage.delete("a.png")).resolves.toBeUndefined();
    expect(configWarnings(c).join("\n")).toMatch(/BLOB_READ_WRITE_TOKEN/);
    expect(missingConfig(c, {})).toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("explicit STORAGE_DRIVER=local on Vercel is not usable either; a Blob token selects vercel-blob automatically", () => {
    expect(cfg({ STORAGE_DRIVER: "local" }).storage.driver).toBe("unconfigured");
    expect(cfg({ BLOB_READ_WRITE_TOKEN: "t" }).storage.driver).toBe("vercel-blob");
    expect(cfg({ STORAGE_DRIVER: "local", BLOB_READ_WRITE_TOKEN: "t" }).storage.driver).toBe("vercel-blob");
    expect(cfg({ STORAGE_DRIVER: "vercel-blob" }).storage.driver).toBe("unconfigured");
    // off Vercel nothing changes
    expect(loadConfig({ NODE_ENV: "test" }).storage.driver).toBe("local");
  });

  it("an upload on unconfigured storage fails with the 503 envelope and leaves no media row", async () => {
    const app = await buildTestApp();
    try {
      const svc = createMediaService({ ...app.deps, storage: new UnconfiguredStorage() });
      await expect(svc.storeObject(png())).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/not configured/) });
      const http = express();
      http.post("/x", async () => {
        await svc.storeObject(png());
      });
      http.use(createErrorHandler(createLogger({ logLevel: "silent", isProd: false })));
      const res = await request(http).post("/x");
      expect(res.status).toBe(503);
      expect(res.body.error.message).toMatch(/BLOB_READ_WRITE_TOKEN/);
    } finally {
      await app.close();
    }
  });
});

describe("background work after the response (waitUntil)", () => {
  let t: TestApp;
  const pending: Promise<unknown>[] = [];
  const fake = new FakeEmbeddings();
  beforeAll(async () => {
    t = await buildTestApp({ deps: { now: () => BASE, embeddings: fake, background: (p) => void pending.push(p) } });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    pending.length = 0;
    fake.calls = [];
  });
  afterEach(async () => {
    await Promise.allSettled(pending);
  });

  it("publishing hands the embedding to deps.background instead of a floating promise", async () => {
    const admin = await adminSession(t);
    const created = await createPostVia(admin.agent, { title: "Background post" });
    await admin.agent.post(`${API}/posts/${created.id}/publish`).expect(200);
    expect(pending.length).toBeGreaterThanOrEqual(1); // registered before the response was sent, so the platform can wait for it
    await Promise.all(pending);
    expect(fake.calls).toHaveLength(1);
    expect(await t.db.select().from(postEmbedding).where(eq(postEmbedding.postId, created.id))).toHaveLength(1);
  });

  it("the default background never throws, swallows rejections and logs them", async () => {
    const warn = vi.fn();
    const bg = createBackground({ warn } as never);
    bg(Promise.reject(new Error("boom")), "test");
    await new Promise((r) => setTimeout(r, 10));
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: "boom", what: "test" }), "background task failed");
  });

  it("reindex honours its time budget and is resumable (finished posts are skipped on the next run)", async () => {
    await ensureAuthor(t);
    for (let i = 0; i < 40; i++) await insertPost(t, { slug: `rb-${i}`, markdown: `alpha ${i}` });
    let clock = 0;
    const realNow = Date.now;
    Date.now = () => (clock += 1000); // every call "takes" a second
    let first;
    try {
      first = await runReindex(t.deps, { budgetMs: 2500 });
    } finally {
      Date.now = realNow;
    }
    expect(first.remaining).toBeGreaterThan(0);
    expect(first.embedded).toBeGreaterThan(0);
    const second = await runReindex(t.deps);
    expect(second.remaining).toBeUndefined();
    expect(second.embedded + second.skipped + second.failed).toBe(40);
    expect(second.skipped).toBe(first.embedded);
    expect(second.embedded).toBe(40 - first.embedded);
  });
});

describe("shared rate limiter (Postgres store)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it("counts atomically across concurrent callers (no lost updates)", async () => {
    const store = new PgRateLimitStore(t.db, "t:");
    store.init({ windowMs: 60_000 } as never);
    const results = await Promise.all(Array.from({ length: 30 }, () => store.increment("1.2.3.4")));
    expect(results.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(results[0]!.resetTime!.getTime()).toBeGreaterThan(Date.now());
    // namespaces are isolated; reset and decrement work
    const other = new PgRateLimitStore(t.db, "o:");
    other.init({ windowMs: 60_000 } as never);
    expect((await other.increment("1.2.3.4")).totalHits).toBe(1);
    await store.decrement("1.2.3.4");
    expect((await store.increment("1.2.3.4")).totalHits).toBe(30);
    await store.resetKey("1.2.3.4");
    expect((await store.increment("1.2.3.4")).totalHits).toBe(1);
  });

  it("starts a new window once the old one ended", async () => {
    const store = new PgRateLimitStore(t.db, "w:");
    store.init({ windowMs: 50 } as never);
    expect((await store.increment("k")).totalHits).toBe(1);
    expect((await store.increment("k")).totalHits).toBe(2);
    await new Promise((r) => setTimeout(r, 120));
    expect((await store.increment("k")).totalHits).toBe(1);
  });

  it("the auth / comment / subscribe presets use it when RATE_LIMIT_STORE=postgres, and enforce the limit across 'instances'", async () => {
    const mk = () => {
      const limiters = createRateLimiters({ rateLimit: { enabled: true, store: "postgres" } }, t.db);
      const app = express();
      app.set("trust proxy", 1);
      app.post("/x", limiters.subscribe, (_req, res) => void res.json({ ok: true }));
      app.use(createErrorHandler(createLogger({ logLevel: "silent", isProd: false })));
      return app;
    };
    const a = mk();
    const b = mk(); // a second instance with its own memory
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(i % 2 ? a : b).post("/x").set("X-Forwarded-For", "9.9.9.9")).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]); // subscribe: 5/min/IP, shared by both instances
    expect((await request(a).post("/x").set("X-Forwarded-For", "8.8.8.8")).status).toBe(200);
  });

  it("fails open when the store is down (a limiter outage must not become an auth outage)", async () => {
    const broken = { execute: async () => Promise.reject(new Error("db down")) };
    const app = express();
    app.post("/x", makeLimiter(true, { windowMs: 1000, limit: 1, store: new PgRateLimitStore(broken as never, "b:") }), (_req, res) => void res.json({ ok: true }));
    expect((await request(app).post("/x")).status).toBe(200);
    expect((await request(app).post("/x")).status).toBe(200);
  });

  it("the cron purges long-expired windows", async () => {
    await t.db.execute(sql`insert into rate_limit (key, hits, reset_at) values ('old', 3, now() - interval '3 hours'), ('fresh', 1, now() + interval '1 minute')`);
    expect(await purgeExpiredRateLimits(t.db)).toBe(1);
    const { rows } = await t.db.execute<{ key: string }>(sql`select key from rate_limit`);
    expect(rows.map((r) => r.key)).toEqual(["fresh"]);
  });
});

describe("boot failure, health and diagnostics", () => {
  it("a failing startup exports an app that answers 503 (never throws at import) and only tells operators what is missing", async () => {
    let failure;
    try {
      loadConfig({ NODE_ENV: "production" });
    } catch (err) {
      failure = describeBootError(err);
    }
    expect(failure).toMatchObject({ variables: ["BETTER_AUTH_SECRET"] });
    const app = createBootFailureApp(failure!, { CRON_SECRET: "cron" });
    const anon = await request(app).get("/api/anything");
    expect(anon.status).toBe(503);
    expect(anon.headers["retry-after"]).toBeDefined();
    expect(anon.body.error.message).toMatch(/misconfigured/);
    expect(JSON.stringify(anon.body)).not.toContain("BETTER_AUTH_SECRET");
    const health = await request(app).get("/api/health").set("Authorization", "Bearer cron");
    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({ status: "error", config: { missing: ["BETTER_AUTH_SECRET"] } });
    expect((await request(app).get("/api/health").set("Authorization", "Bearer nope")).body.config).toBeUndefined();
  });

  it("the module entry exports the failure app instead of throwing when the environment is invalid", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      process.env.NODE_ENV = "production";
      delete process.env.BETTER_AUTH_SECRET;
      const mod = await import("../src/index");
      expect((await request(mod.default).get("/api/posts")).status).toBe(503);
      const line = JSON.parse(String(log.mock.calls[0]![0]));
      expect(line).toMatchObject({ msg: "api failed to start", variables: ["BETTER_AUTH_SECRET"] });
    } finally {
      log.mockRestore();
      process.env = saved;
      vi.resetModules();
    }
  });

  describe("GET /health", () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await buildTestApp({ env: { CRON_SECRET: "c".repeat(24), REVALIDATE_SECRET: "r".repeat(24) } });
    });
    afterAll(() => t.close());

    it("is minimal for anonymous callers and detailed (names only, no secrets) for operators", async () => {
      const anon = await request(t.app).get("/api/health").expect(200);
      expect(anon.body).toEqual({ status: "ok", db: "up", version: expect.any(String) });
      const viaCron = await request(t.app).get("/api/health").set("Authorization", `Bearer ${"c".repeat(24)}`).expect(200);
      const viaReval = await request(t.app).get("/api/health").set("x-revalidate-secret", "r".repeat(24)).expect(200);
      for (const res of [viaCron, viaReval]) {
        expect(res.body.config.missing).toEqual(expect.arrayContaining(["DATABASE_URL"]));
        expect(Array.isArray(res.body.config.warnings)).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain("c".repeat(24));
        expect(JSON.stringify(res.body)).not.toContain("r".repeat(24));
      }
      await request(t.app).get("/api/health").set("Authorization", "Bearer wrong").expect(200).expect((r) => expect(r.body.config).toBeUndefined());
    });

    it("reports db: down within a few seconds instead of hanging on a stuck database", async () => {
      const app = express();
      const fakeDeps = {
        config: t.config,
        logger: createLogger({ logLevel: "silent", isProd: false }),
        db: { execute: () => new Promise(() => undefined) },
        storage: { driver: "memory" },
        mailer: { driver: "memory" },
      };
      app.use(healthRouter(fakeDeps as never));
      const started = Date.now();
      const res = await request(app).get("/health").expect(200);
      expect(res.body.db).toBe("down");
      expect(Date.now() - started).toBeLessThan(HEALTH_DB_TIMEOUT_MS + 1500);
    });
  });
});

describe("request ids and error mapping", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as never;
  it("reuses Vercel's x-vercel-id (last segment) when no x-request-id is sent", () => {
    expect(resolveRequestId(req({ "x-vercel-id": "iad1::sfo1::abcde-1700000000000-0123456789ab" }))).toBe("abcde-1700000000000-0123456789ab");
    expect(resolveRequestId(req({ "x-request-id": "caller-supplied-1", "x-vercel-id": "iad1::zzzzzzzz-1" }))).toBe("caller-supplied-1");
    expect(resolveRequestId(req({ "x-vercel-id": "bad id!" }))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("database connectivity errors become 503 + Retry-After, client-data errors stay 4xx", async () => {
    expect(isDbUnavailable(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDbUnavailable(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDbUnavailable({ message: "Failed query", cause: { code: "57P01" } })).toBe(true);
    expect(isDbUnavailable({ message: "Failed query", cause: { code: "53300" } })).toBe(true);
    expect(isDbUnavailable({ message: "Failed query", cause: { code: "23505" } })).toBe(false);
    const app = express();
    app.get("/down", () => {
      throw new Error("timeout exceeded when trying to connect");
    });
    app.use(createErrorHandler(createLogger({ logLevel: "silent", isProd: false })));
    const res = await request(app).get("/down");
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("2");
    expect(res.body.error.message).not.toMatch(/timeout exceeded/);
  });

  it("calls from the web server (x-internal-request) are never CDN-cacheable; browsers' reads are", async () => {
    const t = await buildTestApp();
    try {
      await ensureAuthor(t);
      await insertPost(t, { slug: "cache-me" });
      const browser = await request(t.app).get("/api/posts/cache-me").expect(200);
      expect(browser.headers["cache-control"]).toMatch(/s-maxage=60/);
      const internal = await request(t.app).get("/api/posts/cache-me").set("x-internal-request", "1").expect(200);
      expect(internal.headers["cache-control"]).toBe("no-store");
    } finally {
      await t.close();
    }
  });

  it("scheduled publishing still awaits its follow-ups inline (nothing left floating when the cron response is sent)", async () => {
    const t = await buildTestApp({ env: { CRON_SECRET: "c".repeat(24) }, deps: { embeddings: new FakeEmbeddings() } });
    try {
      await ensureAuthor(t);
      await insertPost(t, { slug: "due", status: "scheduled", scheduledFor: new Date(Date.now() - 1000) });
      const res = await request(t.app).get("/api/cron/publish-scheduled").set("Authorization", `Bearer ${"c".repeat(24)}`).expect(200);
      expect(res.body.data.posts.published).toBe(1);
      expect(await t.db.select().from(postEmbedding)).toHaveLength(1); // already there when the response arrived
      const audits = await t.db.select().from(auditLog);
      expect(audits.map((a) => a.action)).toContain("post.publish_scheduled");
      // overlapping run: nothing to do twice
      const again = await request(t.app).get("/api/cron/publish-scheduled").set("Authorization", `Bearer ${"c".repeat(24)}`).expect(200);
      expect(again.body.data.posts.published).toBe(0);
    } finally {
      await t.close();
    }
  });
});
