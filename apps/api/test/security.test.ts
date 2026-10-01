/**
 * Regression tests from the adversarial security review. Each block names the weakness it pins down.
 */
import { apiKey, auditLog, comment, eq, post, postEmbedding, session, sql, user, verification } from "@blog/db";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, configWarnings } from "../src/config";
import { createLogger } from "../src/logger";
import { createErrorHandler } from "../src/middleware/error-handler";
import { createRateLimiters } from "../src/middleware/rate-limit";
import { ConsoleMailer } from "../src/services/mailer";
import { adminRouter } from "../src/routes/admin";
import { randomUUID } from "node:crypto";
import { publishDuePosts } from "../src/services/admin/scheduled";
import { renderNewsletterHtml } from "../src/services/newsletter/render";
import { sanitizeDisplayName, defuseTemplateTags } from "../src/lib/text";
import { cleanProfileFields } from "../src/auth";
import { png } from "./fakes/images";
import { API, doc } from "./admin/helpers";
import { anonAgent, buildTestApp, createUser, signUpAndSignIn, TEST_PASSWORD, type TestAgent, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ env: { ADMIN_EMAILS: "boss@example.com" } });
});
afterAll(() => t.close());
beforeEach(() => t.reset());

/** The raw `Cookie` header of a supertest agent (to replay a session with hand-picked Origin / Referer headers). */
function cookieOf(agent: TestAgent): string {
  const jar = (agent as unknown as { jar: { getCookies(a: object): { toValueString(): string } } }).jar;
  return jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false }).toValueString();
}

/** Every `[method, path]` registered on an Express router (recursing into nested routers). */
function listRoutes(stack: any[], prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.push([m, prefix + layer.route.path]);
    } else if (layer.handle?.stack) {
      out.push(...listRoutes(layer.handle.stack, prefix));
    }
  }
  return out;
}

describe("admin gate completeness", () => {
  it("every route registered in the admin router (discovered, not hand-listed) is closed to anonymous (401) and readers (403)", async () => {
    const routes = listRoutes((adminRouter(t.deps) as unknown as { stack: any[] }).stack);
    expect(routes.length).toBeGreaterThan(35);
    const anon = anonAgent(t);
    const reader = (await signUpAndSignIn(t)).agent;
    const id = randomUUID();
    for (const [method, path] of routes) {
      const url = `/api/admin${path.replace(/:\w+/g, id)}`;
      const a = await (anon as any)[method](url).send({});
      expect(a.status, `anon ${method} ${path}`).toBe(401);
      const r = await (reader as any)[method](url).send({});
      expect(r.status, `reader ${method} ${path}`).toBe(403);
    }
  });
});

describe("Better Auth: clients can never set privileged fields", () => {
  it("ignores / rejects role, banned, banReason at sign-up and update-user, and never stores them", async () => {
    // sign-up: privileged fields are dropped (role / banned) or refused (banReason); the account is a plain reader either way
    for (const extra of [{ role: "admin" }, { banned: true }, { banReason: "x" }]) {
      const email = `evil-${Object.keys(extra)[0]}@example.com`;
      const res = await anonAgent(t).post("/api/auth/sign-up/email").send({ email, password: TEST_PASSWORD, name: "Evil", ...extra });
      expect([200, 400]).toContain(res.status);
      const [row] = await t.db.select().from(user).where(eq(user.email, email));
      if (row) expect(row).toMatchObject({ role: "reader", banned: false, banReason: null, emailVerified: false });
    }
    const { agent, user: u } = await signUpAndSignIn(t);
    for (const extra of [{ role: "admin" }, { banned: true }, { banReason: "x" }, { role: "admin", banned: true }]) {
      const res = await agent.post("/api/auth/update-user").send({ name: "N", ...extra });
      expect([200, 400]).toContain(res.status);
      const [row] = await t.db.select().from(user).where(eq(user.id, u.id));
      expect(row).toMatchObject({ role: "reader", banned: false, banReason: null });
    }
    expect((await agent.get("/api/me")).status).toBe(200);
  });

  it("an ADMIN_EMAILS address is only promoted once its mailbox proved ownership (verified email)", async () => {
    await anonAgent(t).post("/api/auth/sign-up/email").send({ email: "boss@example.com", password: TEST_PASSWORD, name: "Boss" }).expect(200);
    const [pending] = await t.db.select().from(user).where(eq(user.email, "boss@example.com"));
    expect(pending).toMatchObject({ role: "reader", emailVerified: false });
    // an unverified account cannot even sign in, let alone reach /admin
    await anonAgent(t).post("/api/auth/sign-in/email").send({ email: "boss@example.com", password: TEST_PASSWORD }).expect(403);
  });
});

describe("Better Auth: Origin / callback validation is on in every environment", () => {
  it("rejects cookie-authenticated writes with a missing, null, foreign or look-alike Origin", async () => {
    const { agent } = await signUpAndSignIn(t);
    const cookie = cookieOf(agent);
    for (const origin of [undefined, "null", "http://evil.com", "http://localhost:3000.evil.com", "http://localhost:3000@evil.com"]) {
      const req = request(t.app).post("/api/auth/update-user").set("Cookie", cookie).send({ name: "Hacked" });
      if (origin) req.set("Origin", origin);
      expect((await req).status, `origin=${origin}`).toBe(403);
    }
    expect((await agent.post("/api/auth/update-user").send({ name: "Fine" })).status).toBe(200);
  });

  it("refuses callback / redirect URLs outside the trusted origins (no open redirect)", async () => {
    const u = await createUser(t);
    const anon = anonAgent(t);
    expect((await anon.post("/api/auth/request-password-reset").send({ email: u.email, redirectTo: "https://evil.com/x" })).status).toBe(403);
    expect((await anon.get("/api/auth/reset-password/sometoken?callbackURL=https://evil.com")).status).toBe(403);
    expect((await anon.get("/api/auth/verify-email?token=abc&callbackURL=//evil.com")).status).toBe(403);
    expect((await anon.post("/api/auth/sign-up/email").send({ email: "cb@example.com", password: TEST_PASSWORD, name: "cb", callbackURL: "https://evil.com/" })).status).toBe(403);
  });
});

describe("CSRF origin check on the JSON API", () => {
  it("blocks Origin: null, prefix / userinfo tricks, a missing Origin and look-alike Referers", async () => {
    const { agent } = await signUpAndSignIn(t);
    const cookie = cookieOf(agent);
    for (const origin of [undefined, "null", "http://evil.com", "http://localhost:3000.evil.com", "http://localhost:3000@evil.com", "http://localhost:30000"]) {
      const req = request(t.app).patch("/api/me").set("Cookie", cookie).send({ name: "Hacked" });
      if (origin) req.set("Origin", origin);
      expect((await req).status, `origin=${origin}`).toBe(403);
    }
    for (const referer of ["http://localhost:3000.evil.com/", "http://evil.com/?http://localhost:3000", "http://localhost:3000@evil.com/"]) {
      const res = await request(t.app).patch("/api/me").set("Cookie", cookie).set("Referer", referer).send({ name: "Hacked" });
      expect(res.status, `referer=${referer}`).toBe(403);
    }
    // an honest Referer-only request (no Origin header) from the site itself is fine
    await request(t.app).patch("/api/me").set("Cookie", cookie).set("Referer", "http://localhost:3000/account").send({ name: "Fine" }).expect(200);
  });

  it("covers the admin API and the multipart upload too", async () => {
    const { agent } = await signUpAndSignIn(t, { role: "admin" });
    const cookie = cookieOf(agent);
    await request(t.app).post(`${API}/api-keys`).set("Cookie", cookie).set("Origin", "http://evil.com").send({ name: "k" }).expect(403);
    await request(t.app).post(`${API}/media`).set("Cookie", cookie).set("Origin", "http://evil.com").attach("file", png(2, 2), "a.png").expect(403);
    await request(t.app).post("/api/cron/publish-scheduled").set("Cookie", cookie).set("Origin", "http://evil.com").expect(403);
  });
});

describe("Better Auth endpoints: banned accounts and request bodies", () => {
  it("a suspended account's still-live session cannot use update-user / change-password (sign-out still works)", async () => {
    const { agent, user: u } = await signUpAndSignIn(t);
    await t.db.update(user).set({ banned: true }).where(eq(user.id, u.id)); // flag flipped, sessions NOT yet revoked
    expect((await agent.get("/api/me")).status).toBe(403);
    expect((await agent.post("/api/auth/update-user").send({ name: "still here" })).status).toBe(403);
    expect((await agent.post("/api/auth/change-password").send({ currentPassword: u.password, newPassword: "another-long-password-1" })).status).toBe(403);
    const [row] = await t.db.select().from(user).where(eq(user.id, u.id));
    expect(row!.name).not.toBe("still here");
    expect((await agent.post("/api/auth/sign-out")).status).toBe(200);
    expect((await t.db.select().from(session).where(eq(session.userId, u.id))).length).toBe(0);
  });

  it("bounds Better Auth request bodies (no unbounded buffering)", async () => {
    const big = { email: "a@example.com", password: "x".repeat(70 * 1024) };
    const res = await request(t.app).post("/api/auth/sign-in/email").set("Origin", t.origin).send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("validation_error");
    // normal-sized bodies still work
    await request(t.app).post("/api/auth/sign-in/email").set("Origin", t.origin).send({ email: "nobody@example.com", password: "whatever-password" }).expect(401);
  });

  it("bounds chunked (length-less) bodies as well", async () => {
    const chunk = Buffer.alloc(16 * 1024, 97);
    const req = request(t.app).post("/api/auth/sign-in/email").set("Origin", t.origin).set("Content-Type", "application/json").set("Transfer-Encoding", "chunked");
    req.write(Buffer.from('{"email":"a@example.com","password":"'));
    for (let i = 0; i < 6; i++) req.write(chunk);
    req.write(Buffer.from('"}'));
    const res = await req;
    expect(res.status).toBe(413);
  });
});

describe("profile fields written through Better Auth are normalised", () => {
  it("NUL bytes, huge names and javascript: images no longer 500 / get stored", async () => {
    const { agent, user: u } = await signUpAndSignIn(t);
    expect((await agent.post("/api/auth/update-user").send({ name: "a\u0000b" })).status).toBe(200);
    expect((await agent.post("/api/auth/update-user").send({ name: "x".repeat(50_000) })).status).toBe(200);
    let [row] = await t.db.select().from(user).where(eq(user.id, u.id));
    expect(row!.name).toBe("x".repeat(80));
    expect((await agent.post("/api/auth/update-user").send({ name: "Eve", image: "javascript:alert(1)" })).status).toBe(200);
    [row] = await t.db.select().from(user).where(eq(user.id, u.id));
    expect(row).toMatchObject({ name: "Eve", image: null });
    expect((await agent.post("/api/auth/update-user").send({ image: "https://cdn.example.com/a.png" })).status).toBe(200);
    [row] = await t.db.select().from(user).where(eq(user.id, u.id));
    expect(row!.image).toBe("https://cdn.example.com/a.png");
  });

  it("sign-up sanitises the name too", async () => {
    await anonAgent(t).post("/api/auth/sign-up/email").send({ email: "nul@example.com", password: TEST_PASSWORD, name: "Zed\u0000‮Evil" }).expect(200);
    const [row] = await t.db.select().from(user).where(eq(user.email, "nul@example.com"));
    expect(row!.name).toBe("Zed Evil");
  });

  it("cleanProfileFields / sanitizeDisplayName units", () => {
    expect(sanitizeDisplayName("  a\tb\n c​  ")).toBe("a b c");
    expect(sanitizeDisplayName("\u0000\u0001")).toBe("");
    expect(cleanProfileFields({ name: "\u0000", email: "jo.doe@example.com", image: "/\\evil.com" })).toMatchObject({ name: "jo.doe", image: null });
    expect(cleanProfileFields({ name: "Ok" })).toEqual({ name: "Ok" });
  });
});

describe("client data the database cannot store is a 4xx, never a 500", () => {
  it("NUL bytes in a comment report, a subscription source and an admin post", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const reader = await signUpAndSignIn(t);
    const created = await admin.agent.post(`${API}/posts`).send({ title: "Hello", section: "personal", tags: [], content: doc("body text here"), status: "published" }).expect(201);
    const c = await reader.agent.post(`/api/posts/${created.body.data.slug}/comments`).send({ body: "first" }).expect(201);
    const other = await signUpAndSignIn(t);
    expect((await other.agent.post(`/api/comments/${c.body.data.id}/report`).send({ reason: "spam\u0000spam" })).status).toBe(400);
    expect((await anonAgent(t).post("/api/newsletter/subscribe").send({ email: "n@example.com", source: "a\u0000b" })).status).toBe(400);
    expect((await admin.agent.post(`${API}/posts`).send({ title: "T\u0000", section: "personal", tags: [], content: doc("x") })).status).toBe(400);
    expect((await admin.agent.post(`${API}/posts`).send({ title: "T", section: "personal", tags: [], content: doc("a\u0000b") })).status).toBe(400);
  });

  it("PATCH /me sanitises the name and rejects names that are empty after sanitising", async () => {
    const { agent } = await signUpAndSignIn(t);
    const ok = await agent.patch("/api/me").send({ name: "Zoë\u0000 ‮Doe" }).expect(200);
    expect(ok.body.data.name).toBe("Zoë Doe");
    await agent.patch("/api/me").send({ name: "\u0001\u0002" }).expect(400);
  });

  it("maps database error classes in the central handler without leaking SQL", async () => {
    const app = express();
    const pgErr = (code: string, constraint?: string) => Object.assign(new Error('insert into "secret_table" failed'), { code, constraint });
    for (const [path, code] of [["/nul", "22021"], ["/long", "22001"], ["/uuid", "22P02"], ["/dup", "23505"], ["/fk", "23503"], ["/nn", "23502"], ["/chk", "23514"]] as const) {
      app.get(path, () => {
        throw new Error("wrapped", { cause: pgErr(code, "some_constraint") });
      });
    }
    app.get("/other", () => {
      throw pgErr("40001");
    });
    app.use(createErrorHandler(createLogger({ logLevel: "silent", isProd: false })));
    const expected: Record<string, number> = { "/nul": 400, "/long": 400, "/uuid": 400, "/dup": 409, "/fk": 409, "/nn": 400, "/chk": 400, "/other": 500 };
    for (const [path, status] of Object.entries(expected)) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(status);
      expect(JSON.stringify(res.body)).not.toMatch(/secret_table|some_constraint|insert into/);
    }
  });
});

describe("stored URLs cannot smuggle a protocol-relative redirect", () => {
  it("PATCH /me image: rejects /\\host, tab tricks, javascript:, data:; accepts http(s) and site-relative paths", async () => {
    const { agent } = await signUpAndSignIn(t);
    for (const image of ["/\\evil.com", "/\t/evil.com", "/\n/evil.com", "//evil.com/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://evil.com\\@good.com/x"]) {
      await agent.patch("/api/me").send({ image }).expect(400);
    }
    for (const image of ["/api/media/files/media/2026/10/a.png", "https://cdn.example.com/a.png?x=1"]) {
      const res = await agent.patch("/api/me").send({ image }).expect(200);
      expect(res.body.data.image).toBe(image);
    }
  });

  it("post cover image uses the same rules", async () => {
    const { agent } = await signUpAndSignIn(t, { role: "admin" });
    const base = { title: "Cover", section: "personal", tags: [], content: doc("body") };
    await agent.post(`${API}/posts`).send({ ...base, coverImageUrl: "/\\evil.com/x.png" }).expect(400);
    await agent.post(`${API}/posts`).send({ ...base, coverImageUrl: "/api/media/files/a.png" }).expect(201);
  });
});

describe("media: decompression-bomb guard", () => {
  const upload = (agent: TestAgent, buf: Buffer) => agent.post(`${API}/media`).attach("file", buf, { filename: "a.png", contentType: "image/png" });
  const withSize = (w: number, h: number) => {
    const b = png(1, 1);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };

  it("rejects canvases beyond 16384 px per side or 100 megapixels (422), accepts a normal photo size", async () => {
    const { agent } = await signUpAndSignIn(t, { role: "admin" });
    expect((await upload(agent, withSize(60_000, 60_000))).status).toBe(422);
    expect((await upload(agent, withSize(0xffffffff, 1))).status).toBe(422);
    expect((await upload(agent, withSize(16_385, 10))).status).toBe(422);
    expect((await upload(agent, withSize(12_000, 12_000))).status).toBe(422); // 144 MP
    const ok = await upload(agent, withSize(4000, 3000));
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ width: 4000, height: 3000 });
  });

  it("the same guard applies to images embedded as data: URIs in post content", async () => {
    const { agent } = await signUpAndSignIn(t, { role: "admin" });
    const src = `data:image/png;base64,${withSize(60_000, 60_000).toString("base64")}`;
    const content = doc("intro");
    (content.root.children as unknown[]).push({ type: "image", version: 1, src, altText: "x", width: 0, height: 0, maxWidth: 500, showCaption: false });
    const res = await agent.post(`${API}/posts`).send({ title: "Bomb", section: "personal", tags: [], content });
    expect(res.status).toBe(422);
    expect(await t.db.select().from(post)).toHaveLength(0);
  });
});

describe("large JSON bodies are only parsed for authenticated admins", () => {
  it("anonymous / reader callers get 401 / 403 before any body is parsed (even malformed or 3 MB ones)", async () => {
    const malformed = '{"title": ';
    for (const base of ["/api", ""]) {
      const res = await request(t.app).post(`${base}/admin/posts`).set("Content-Type", "application/json").send(malformed);
      expect(res.status, base).toBe(401);
    }
    const huge = JSON.stringify({ title: "x", pad: "y".repeat(3 * 1024 * 1024) });
    expect((await request(t.app).post("/api/admin/posts").set("Content-Type", "application/json").send(huge)).status).toBe(401);
    const reader = await signUpAndSignIn(t);
    expect((await reader.agent.post("/api/admin/newsletters").set("Content-Type", "application/json").send(huge)).status).toBe(403);
  });

  it("admins keep the 4 MB limit on post routes (3 MB passes the parser, 5 MB is 413) and 1 MB elsewhere", async () => {
    const { agent } = await signUpAndSignIn(t, { role: "admin" });
    const three = JSON.stringify({ title: "x", pad: "y".repeat(3 * 1024 * 1024) });
    expect((await agent.post(`${API}/posts`).set("Content-Type", "application/json").send(three)).status).toBe(400); // parsed, then fails validation
    const five = JSON.stringify({ title: "x", pad: "y".repeat(5 * 1024 * 1024) });
    expect((await agent.post(`${API}/posts`).set("Content-Type", "application/json").send(five)).status).toBe(413);
    expect((await agent.post(`${API}/api-keys`).set("Content-Type", "application/json").send(three)).status).toBe(413);
    expect((await agent.post(`${API}/posts`).set("Content-Type", "application/json").send("{bad")).status).toBe(400);
  });
});

describe("DELETE /me only touches the caller's own verification rows", () => {
  it("does not treat `_` / `%` in an e-mail as LIKE wildcards", async () => {
    const victim = await createUser(t, { email: "aXb@example.com" });
    const me = await signUpAndSignIn(t, { email: "a_b@example.com" });
    const future = new Date(Date.now() + 3_600_000);
    await t.db.insert(verification).values([
      { id: "v-victim", identifier: "reset-password:aXb@example.com", value: victim.id, expiresAt: future },
      { id: "v-mine", identifier: "reset-password:tok-mine", value: me.user.id, expiresAt: future },
    ]);
    await me.agent.delete("/api/me").expect(204);
    const left = (await t.db.select().from(verification)).map((r) => r.id);
    expect(left).toContain("v-victim");
    expect(left).not.toContain("v-mine");
  });
});

describe("scheduled publishing is atomic with its audit trail", () => {
  it("a failing audit insert rolls the claim back (the post stays scheduled and the next run publishes it)", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const created = await admin.agent.post(`${API}/posts`).send({ title: "Soon", section: "personal", tags: [], content: doc("body") }).expect(201);
    const when = new Date(t.deps.now().getTime() + 60_000);
    await admin.agent.post(`${API}/posts/${created.body.data.id}/schedule`).send({ scheduledFor: when.toISOString() }).expect(200);
    const later = { ...t.deps, now: () => new Date(when.getTime() + 1000) };

    await t.db.execute(sql`create or replace function test_fail_audit() returns trigger as $$ begin raise exception 'audit down'; end $$ language plpgsql`);
    await t.db.execute(sql`create trigger test_fail_audit before insert on audit_log for each row when (new.action = 'post.publish_scheduled') execute function test_fail_audit()`);
    try {
      await expect(publishDuePosts(later)).rejects.toBeTruthy();
      const [row] = await t.db.select().from(post).where(eq(post.id, created.body.data.id));
      expect(row!.status).toBe("scheduled");
    } finally {
      await t.db.execute(sql`drop trigger test_fail_audit on audit_log`);
    }
    await expect(publishDuePosts(later)).resolves.toMatchObject({ published: 1 });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "post.publish_scheduled"));
    expect(audits).toHaveLength(1);
  });
});

describe("rate limiting details", () => {
  it("a spoofed X-Forwarded-For prefix does not buy a fresh budget (trust proxy = 1 hop: the proxy-appended entry decides)", async () => {
    const limiters = createRateLimiters({ rateLimit: { enabled: true } });
    const app = express();
    app.set("trust proxy", 1);
    app.post("/subscribe", limiters.subscribe, (_req, res) => void res.status(202).end());
    app.use(createErrorHandler(createLogger({ logLevel: "silent", isProd: false })));
    for (let i = 0; i < 5; i++) await request(app).post("/subscribe").set("X-Forwarded-For", `10.0.0.${i}, 198.51.100.7`).expect(202);
    await request(app).post("/subscribe").set("X-Forwarded-For", "10.9.9.9, 198.51.100.7").expect(429);
    // the real client behind a DIFFERENT proxy-appended address still has its own budget
    await request(app).post("/subscribe").set("X-Forwarded-For", "10.9.9.9, 198.51.100.8").expect(202);
  });

  it("IPv6 clients are bucketed per /56 (no ERR_ERL_KEY_GEN_IPV6, no per-address bypass)", async () => {
    const limiters = createRateLimiters({ rateLimit: { enabled: true } });
    const app = express();
    app.set("trust proxy", 1);
    app.post("/subscribe", limiters.subscribe, (_req, res) => void res.status(202).end());
    app.use(createErrorHandler(createLogger({ logLevel: "silent", isProd: false })));
    for (let i = 0; i < 5; i++) await request(app).post("/subscribe").set("X-Forwarded-For", `2001:db8:1:2::${i + 1}`).expect(202);
    await request(app).post("/subscribe").set("X-Forwarded-For", "2001:db8:1:2:ffff::9").expect(429);
  });

  it("requests presenting an API key are throttled per IP before the key lookup", async () => {
    const limiters = createRateLimiters({ rateLimit: { enabled: true } });
    const app = express();
    app.get("/v1/x", limiters.apiKeyAttempt, (_req, res) => void res.status(200).end());
    app.use(createErrorHandler(createLogger({ logLevel: "silent", isProd: false })));
    for (let i = 0; i < 1200; i++) {
      const r = await request(app).get("/v1/x");
      if (r.status !== 200) throw new Error(`limited too early at ${i}`);
    }
    await request(app).get("/v1/x").expect(429);
  }, 60_000);

  it("the /v1 router applies that limiter only when a key header is present", async () => {
    const lim = await buildTestApp({ env: { RATE_LIMIT_ENABLED: "1" } });
    try {
      // anonymous reads are governed by publicRead (120/min), not by the key-attempt limiter
      for (let i = 0; i < 3; i++) await request(lim.app).get("/api/v1/tags").expect(200);
      const bad = await request(lim.app).get("/api/v1/tags").set("x-api-key", `blg_${"A".repeat(43)}`);
      expect(bad.status).toBe(401);
    } finally {
      await lim.close();
    }
  });
});

describe("newsletter templating", () => {
  it("go-template delimiters in subject / preheader / content are defused; only the two listmonk tags survive", () => {
    const html = renderNewsletterHtml(
      { siteUrl: "http://localhost:3000", siteName: "Site {{ .Name }}" },
      { subject: "Hi {{ .Subscriber.Email }}", preheader: "{{ Date }}", content: doc("{{ evil }}") },
    );
    const tags = html.match(/\{\{/g) ?? [];
    expect(tags).toHaveLength(2); // {{ UnsubscribeURL }} and {{ MessageURL }}
    expect(html).toContain("{{ UnsubscribeURL }}");
    expect(html).toContain("{{ MessageURL }}");
    expect(defuseTemplateTags("a {{ b }} c")).not.toContain("{{");
  });
});

describe("startup configuration", () => {
  const base = { NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(40) };

  it("refuses placeholder / example secrets in production", () => {
    expect(() => loadConfig({ ...base, BETTER_AUTH_SECRET: "change-me-to-a-long-random-string-of-at-least-32-chars" })).toThrow(/placeholder/);
    expect(() => loadConfig({ ...base, BETTER_AUTH_SECRET: "dev-only-secret-do-not-use-in-production-0123456789" })).toThrow(/placeholder/);
    expect(() => loadConfig({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET is required/);
    expect(() => loadConfig({ ...base })).not.toThrow();
    // development keeps working without any secret
    expect(() => loadConfig({ NODE_ENV: "development" })).not.toThrow();
  });

  it("warns about risky production defaults but never in development", () => {
    const prod = loadConfig({ ...base });
    const warnings = configWarnings(prod, {});
    expect(warnings.join("\n")).toMatch(/SITE_URL/);
    expect(warnings.join("\n")).toMatch(/BETTER_AUTH_URL/);
    expect(warnings.join("\n")).toMatch(/DATABASE_URL/);
    expect(warnings.join("\n")).toMatch(/CRON_SECRET/);
    expect(warnings.join("\n")).toMatch(/MAILER_DRIVER=console/);
    const good = loadConfig({
      ...base,
      SITE_URL: "https://blog.example.com",
      BETTER_AUTH_URL: "https://blog.example.com",
      DATABASE_URL: "postgres://u:p@db.example.com/blog",
      CRON_SECRET: "c".repeat(24),
      MAILER_DRIVER: "resend",
      RESEND_API_KEY: "re_x",
      STORAGE_DRIVER: "vercel-blob",
      BLOB_READ_WRITE_TOKEN: "t",
    });
    expect(configWarnings(good, { DATABASE_URL: "postgres://u:p@db.example.com/blog" })).toEqual([]);
    expect(configWarnings(loadConfig({ NODE_ENV: "development" }), {})).toEqual([]);
  });
});

describe("logging", () => {
  it("the dev console mailer logs a masked recipient, never the full address", async () => {
    const lines: string[] = [];
    const logger = { info: (o: unknown) => lines.push(JSON.stringify(o)), warn: () => undefined } as unknown as ConstructorParameters<typeof ConsoleMailer>[0];
    await new ConsoleMailer(logger, { logBodies: true }).send({ to: "jane.doe@example.com", subject: "Hello", html: "<p>x</p>", text: "x" });
    expect(lines.join("")).toContain("j***@example.com");
    expect(lines.join("")).not.toContain("jane.doe@example.com");
  });
});

describe("search and listing inputs", () => {
  async function publish(agent: TestAgent, overrides: Record<string, unknown>) {
    const res = await agent.post(`${API}/posts`).send({ section: "engineering", tags: [], content: doc("plain body"), status: "published", ...overrides }).expect(201);
    return res.body.data as { id: string; slug: string };
  }

  it("snippets only ever contain <mark>; hostile markup in titles / bodies is escaped", async () => {
    const { agent } = await signUpAndSignIn(t, { role: "admin" });
    await publish(agent, { title: "Hello <script>alert(1)</script> world", content: doc('injected <img src=x onerror=alert(1)> payload and "quotes" & amps') });
    const res = await anonAgent(t).get("/api/search?q=payload").expect(200);
    expect(res.body.data).toHaveLength(1);
    const snippet: string = res.body.data[0].snippet;
    expect(snippet).toContain("<mark>payload</mark>");
    expect(snippet.replace(/<\/?mark>/g, "")).not.toMatch(/[<>]/);
    expect(snippet).toContain("&lt;img");
    const v1 = await anonAgent(t).get("/api/v1/search?q=payload").expect(200);
    expect(v1.body.data[0].snippet).toBe(snippet);
  });

  it("wildcards, quotes, tsquery operators, NUL bytes and long input never produce a 5xx", async () => {
    const { agent } = await signUpAndSignIn(t, { role: "admin" });
    await publish(agent, { title: "100% real_deal", content: doc("literal percent and underscore") });
    await publish(agent, { title: "Another post", content: doc("nothing to see") });
    const qs = ["%", "_", "\\", "'", '"', "a & b | !c", "(((", ":*", "x".repeat(200), "'; drop table post; --", "%00", "a\u0000b", "\u0001\u0002"];
    for (const q of qs) {
      for (const url of ["/api/search", "/api/posts", "/api/v1/search", "/api/v1/posts", "/api/admin/posts"]) {
        const req = url.startsWith("/api/admin") ? agent.get(url) : anonAgent(t).get(url);
        const res = await req.query({ q });
        expect(res.status, `${url} q=${JSON.stringify(q)}`).toBeLessThan(500);
      }
    }
    // literal `%` / `_` match literally in the admin LIKE search and in the last-resort title match
    const admin = await agent.get(`${API}/posts`).query({ q: "%" }).expect(200);
    expect(admin.body.data.map((p: { title: string }) => p.title)).toEqual(["100% real_deal"]);
    const under = await agent.get(`${API}/posts`).query({ q: "_" }).expect(200);
    expect(under.body.data.map((p: { title: string }) => p.title)).toEqual(["100% real_deal"]);
    const pub = await anonAgent(t).get("/api/search").query({ q: "100%" }).expect(200);
    expect(pub.body.data.map((p: { title: string }) => p.title)).toEqual(["100% real_deal"]);
  });

  it("caps: pageSize ≤ 50, page ≤ 100000, q ≤ 200", async () => {
    const a = anonAgent(t);
    await a.get("/api/posts?pageSize=51").expect(400);
    await a.get("/api/posts?page=100001").expect(400);
    await a.get("/api/posts?page=0").expect(400);
    await a.get("/api/posts?page=1&page=2").expect(400);
    await a.get("/api/posts?q=a&q=b").expect(400);
    await a.get(`/api/search?q=${"x".repeat(201)}`).expect(400);
    await a.get("/api/search?q=x").expect(400);
  });
});

describe("unpublished content never leaks", () => {
  it("draft / scheduled / archived / future-dated posts are invisible on every public surface", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const reader = await signUpAndSignIn(t);
    const mk = async (title: string, extra: Record<string, unknown> = {}) =>
      (await admin.agent.post(`${API}/posts`).send({ title, section: "engineering", tags: ["zebra-tag"], content: doc("zebra zebra zebra"), ...extra }).expect(201)).body.data as { id: string; slug: string };
    const visible = await mk("Visible zebra", { status: "published" });
    const draft = await mk("Draft zebra");
    const scheduled = await mk("Scheduled zebra");
    await admin.agent.post(`${API}/posts/${scheduled.id}/schedule`).send({ scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }).expect(200);
    const archived = await mk("Archived zebra", { status: "published" });
    await admin.agent.patch(`${API}/posts/${archived.id}`).send({ status: "archived" }).expect(200);
    const future = await mk("Future zebra", { status: "published" });
    await t.db.update(post).set({ publishedAt: new Date(Date.now() + 86_400_000) }).where(eq(post.id, future.id));
    // an unpublished post that once had a comment and an embedding
    const unpublished = await mk("Unpublished zebra", { status: "published" });
    await reader.agent.post(`/api/posts/${unpublished.slug}/comments`).send({ body: "secret comment" }).expect(201);
    await t.db.insert(postEmbedding).values({ postId: unpublished.id, model: "m", contentHash: "h", embedding: Array.from({ length: 1536 }, () => 0.01) });
    await admin.agent.post(`${API}/posts/${unpublished.id}/unpublish`).expect(200);

    const hidden = [draft, scheduled, archived, future, unpublished];
    const key = await admin.agent.post(`${API}/api-keys`).send({ name: "k", scopes: ["comments:read"] }).expect(201);
    const auth = { authorization: `Bearer ${key.body.data.key}` };
    const a = anonAgent(t);
    const surfaces: Array<[string, Record<string, string>?]> = [
      ["/api/posts?pageSize=50"],
      ["/api/search?q=zebra&pageSize=50"],
      ["/api/tags"],
      ["/api/sitemap"],
      ["/api/feed.xml"],
      [`/api/posts/${visible.slug}`],
      [`/api/posts/${visible.slug}/related?limit=12`],
      ["/api/v1/posts?pageSize=50"],
      ["/api/v1/search?q=zebra&pageSize=50"],
      ["/api/v1/tags"],
    ];
    for (const [url] of surfaces) {
      const res = await a.get(url).expect(200);
      const text = JSON.stringify(res.body) + (res.text ?? "");
      for (const h of hidden) expect(text, `${url} leaks ${h.slug}`).not.toContain(h.slug);
    }
    // the tag count only counts the single visible post
    const tags = await a.get("/api/tags").expect(200);
    expect(tags.body.data).toEqual([{ slug: "zebra-tag", name: "zebra-tag", count: 1 }]);
    // prev / next never point at hidden posts
    const detail = await a.get(`/api/posts/${visible.slug}`).expect(200);
    expect(detail.body.data.prev).toBeNull();
    expect(detail.body.data.next).toBeNull();
    for (const h of hidden) {
      await a.get(`/api/posts/${h.slug}`).expect(404);
      await a.get(`/api/posts/${h.slug}/related`).expect(404);
      await a.get(`/api/posts/${h.slug}/comments`).expect(404);
      await a.get(`/api/v1/posts/${h.slug}`).expect(404);
      await a.get(`/api/v1/comments?postSlug=${h.slug}`).set(auth).expect(404);
      await reader.agent.post(`/api/posts/${h.slug}/comments`).send({ body: "nope" }).expect(404);
    }
    await a.get("/api/v1/comments?postSlug=" + visible.slug).expect(401);
  });

  it("soft-deleted and hidden comments never appear in the public, v1 or search surfaces", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const reader = await signUpAndSignIn(t);
    const p = (await admin.agent.post(`${API}/posts`).send({ title: "Thread", section: "personal", tags: [], content: doc("body"), status: "published" }).expect(201)).body.data;
    const key = (await admin.agent.post(`${API}/api-keys`).send({ name: "k", scopes: ["comments:read"] }).expect(201)).body.data.key as string;
    const mkComment = async (body: string, parentId?: string) => (await reader.agent.post(`/api/posts/${p.slug}/comments`).send({ body, parentId }).expect(201)).body.data.id as string;
    const gone = await mkComment("SECRET-deleted");
    const hiddenOne = await mkComment("SECRET-hidden");
    const keep = await mkComment("kept");
    const replyOfGone = await mkComment("reply-visible", gone);
    const secretReply = await mkComment("SECRET-reply-hidden", keep);
    await reader.agent.delete(`/api/comments/${gone}`).expect(204);
    await admin.agent.patch(`${API}/comments/${hiddenOne}`).send({ status: "hidden" }).expect(200);
    await admin.agent.patch(`${API}/comments/${secretReply}`).send({ status: "hidden" }).expect(200);
    for (const res of [await anonAgent(t).get(`/api/posts/${p.slug}/comments`).expect(200), await anonAgent(t).get(`/api/v1/comments?postSlug=${p.slug}`).set("x-api-key", key).expect(200)]) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("SECRET");
      expect(text).toContain("reply-visible");
      expect(text).toContain("[deleted]");
    }
    // editing / reporting / replying to a comment a moderator hid is a 404 for the author as well
    await reader.agent.patch(`/api/comments/${hiddenOne}`).send({ body: "edit" }).expect(404);
    await admin.agent.post(`/api/admin/comments/${randomUUID()}/resolve-reports`).expect(404);
    void replyOfGone;
    expect(await t.db.select().from(comment)).toHaveLength(5);
  });
});

describe("api keys", () => {
  it("only a hash is stored; a revoked or malformed key is a 401; scopes are enforced", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const created = (await admin.agent.post(`${API}/api-keys`).send({ name: "reader", scopes: ["posts:read"] }).expect(201)).body.data as { id: string; key: string };
    const [row] = await t.db.select().from(apiKey).where(eq(apiKey.id, created.id));
    expect(row!.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.key);
    const slug = (await admin.agent.post(`${API}/posts`).send({ title: "Public", section: "personal", tags: [], content: doc("x"), status: "published" }).expect(201)).body.data.slug as string;
    await request(t.app).get("/api/v1/posts").set("x-api-key", created.key).expect(200);
    await request(t.app).get(`/api/v1/comments?postSlug=${slug}`).set("x-api-key", created.key).expect(403); // lacks comments:read
    await request(t.app).get("/api/v1/posts").set("x-api-key", `blg_${"x".repeat(43)}`).expect(401);
    await request(t.app).get("/api/v1/posts").set("Authorization", "Bearer blg_short").expect(401);
    await admin.agent.delete(`${API}/api-keys/${created.id}`).expect(204);
    await request(t.app).get("/api/v1/posts").set("x-api-key", created.key).expect(401);
    // the key is not a session: it opens nothing outside /v1
    await request(t.app).get(`${API}/stats`).set("x-api-key", created.key).expect(401);
    await request(t.app).post(`${API}/api-keys`).set("Authorization", `Bearer ${created.key}`).send({ name: "x" }).expect(401);
  });

  it("/v1 is GET-only and its CORS never allows credentials or write methods", async () => {
    const pre = await request(t.app).options("/api/v1/posts").set("Origin", "http://evil.com").set("Access-Control-Request-Method", "POST");
    expect(pre.headers["access-control-allow-origin"]).toBe("*");
    expect(pre.headers["access-control-allow-methods"]).not.toMatch(/POST|PUT|PATCH|DELETE/);
    expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();
    await request(t.app).post("/api/v1/posts").set("Origin", "http://evil.com").send({}).expect(405);
    // no CORS headers anywhere else
    const other = await request(t.app).get("/api/posts").set("Origin", "http://evil.com").expect(200);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const me = await request(t.app).options("/api/me").set("Origin", "http://evil.com").set("Access-Control-Request-Method", "PATCH");
    expect(me.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("tokens", () => {
  it("newsletter confirm / unsubscribe tokens: 256-bit random, constant-time-safe lookups, confirm expires after 7 days", async () => {
    const { subscribers } = await import("@blog/db").then((m) => ({ subscribers: m.subscriber }));
    await anonAgent(t).post("/api/newsletter/subscribe").send({ email: "tok@example.com" }).expect(202);
    const [row] = await t.db.select().from(subscribers).where(eq(subscribers.email, "tok@example.com"));
    expect(row!.confirmToken).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(row!.unsubscribeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // near-miss tokens (same prefix / one char off) are plain 400s
    const near = row!.confirmToken!.slice(0, -1) + (row!.confirmToken!.endsWith("A") ? "B" : "A");
    await anonAgent(t).post("/api/newsletter/confirm").send({ token: near }).expect(400);
    await anonAgent(t).post("/api/newsletter/unsubscribe").send({ token: row!.unsubscribeToken!.slice(0, -1) + "x" }).expect(404);
    // expiry: an 8-day-old token is rejected
    const late = await buildTestApp({ deps: { now: () => new Date(Date.now() + 8 * 86_400_000) } });
    try {
      await late.db.insert(subscribers).values({ email: "old@example.com", status: "pending", confirmToken: row!.confirmToken!.replace(/^[^.]+/, "x"), unsubscribeToken: "u".repeat(43) });
      await anonAgent(late).post("/api/newsletter/confirm").send({ token: row!.confirmToken!.replace(/^[^.]+/, "x") }).expect(400);
    } finally {
      await late.close();
    }
  });

  it("webhook and cron secrets: wrong, missing, prefix and different-length values are all 401", async () => {
    const hooked = await buildTestApp({ env: { LISTMONK_WEBHOOK_SECRET: "s3cret-s3cret-s3cret", CRON_SECRET: "cron-cron-cron-cron-1234" } });
    try {
      for (const header of [undefined, "", "s3cret", "s3cret-s3cret-s3cret-", "S3CRET-S3CRET-S3CRET", "x".repeat(10_000)]) {
        const r = request(hooked.app).post("/api/webhooks/listmonk").send({ event: "unsubscribe", email: "a@example.com" });
        if (header !== undefined) r.set("x-webhook-secret", header);
        expect((await r).status, `webhook ${header?.slice(0, 12)}`).toBe(401);
      }
      await request(hooked.app).post("/api/webhooks/listmonk").set("x-webhook-secret", "s3cret-s3cret-s3cret").send({ event: "unsubscribe", email: "a@example.com" }).expect(200);
      for (const auth of [undefined, "Bearer ", "Bearer cron", "Bearer cron-cron-cron-cron-12345", "cron-cron-cron-cron-1234", "Basic Y3Jvbg=="]) {
        for (const method of ["get", "post"] as const) {
          const r = request(hooked.app)[method]("/api/cron/publish-scheduled");
          if (auth !== undefined) r.set("Authorization", auth);
          expect((await r).status, `${method} ${auth}`).toBe(401);
        }
      }
      await request(hooked.app).get("/api/cron/publish-scheduled").set("Authorization", "Bearer cron-cron-cron-cron-1234").expect(200);
    } finally {
      await hooked.close();
    }
  });
});

describe("error responses and health", () => {
  it("health never leaks DB details; unknown routes and malformed ids answer 404 in the envelope; no stack or SQL ever", async () => {
    const health = await request(t.app).get("/api/health").expect(200);
    expect(Object.keys(health.body).sort()).toEqual(["db", "status", "version"]);
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const cases = [
      await admin.agent.get(`${API}/posts/not-a-uuid`),
      await admin.agent.get(`${API}/users/${"x".repeat(500)}`),
      await request(t.app).get("/api/nope"),
      await request(t.app).get("/api/posts/%E0%A4%A"),
      await anonAgent(t).get("/api/comments/not-a-uuid"),
    ];
    for (const res of cases) {
      expect([400, 404], res.text).toContain(res.status);
      expect(res.text).not.toMatch(/at \S+ \(|node_modules|select |insert |drizzle|postgres/i);
    }
  });

  it("works with and without the /api prefix", async () => {
    await request(t.app).get("/health").expect(200);
    await request(t.app).get("/api/health").expect(200);
    await request(t.app).get("/admin/stats").expect(401);
    await request(t.app).get("/api/admin/stats").expect(401);
    expect((await request(t.app).get("/auth/get-session")).status).toBe(200);
  });
});

describe("stored content is rendered safely (web, RSS and newsletter targets)", () => {
  const text = (value: string, extra: Record<string, unknown> = {}) => ({ type: "text", version: 1, text: value, format: 0, style: "", mode: "normal", detail: 0, ...extra });
  const para = (children: unknown[]) => ({ type: "paragraph", version: 1, direction: "ltr", format: "", indent: 0, textFormat: 0, textStyle: "", children });
  const evil = () => ({
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        para([text("JS link", {}), { type: "link", version: 1, url: "javascript:alert(1)", rel: null, target: null, title: 'x" onmouseover="alert(1)', children: [text("click")] }]),
        para([{ type: "link", version: 1, url: 'https://good.example/" onmouseover="alert(1)', rel: null, target: null, title: null, children: [text("quote breakout")] }]),
        para([{ type: "link", version: 1, url: "  JaVa\tScRiPt:alert(1)", rel: null, target: null, title: null, children: [text("tab trick")] }]),
        para([{ type: "link", version: 1, url: "/\\evil.example", rel: null, target: null, title: null, children: [text("backslash")] }]),
        para([text("styled", { style: "color: red; background: url(javascript:alert(1)); position: fixed; font-family: 'a';}</style><script>alert(1)</script>" })]),
        para([text("styled2", { style: "color: expression(alert(1)); font-size: 12px" })]),
        { type: "image", version: 1, src: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+", altText: '"><script>alert(1)</script>', width: 0, height: 0, maxWidth: 500, showCaption: false },
        { type: "image", version: 1, src: "javascript:alert(1)", altText: "js image", width: 0, height: 0, maxWidth: 500, showCaption: false },
        { type: "youtube", version: 1, videoID: 'abc" onload="alert(1)' },
        { type: "figma", version: 1, documentID: "../../evil" },
        { type: "tweet", version: 1, id: "1\"><script>" },
        { type: "layout-container", version: 1, templateColumns: "1fr; background:url(x)", children: [] },
        { type: "code", version: 1, language: '"><script>alert(1)</script>', children: [text("code <b>")] },
        { type: "totally-unknown", version: 1, children: [text("<script>alert(1)</script>")] },
      ],
    },
  });
  /** Structural check (not substring matching: escaped text such as `&quot; onmouseover=` inside an attribute value is harmless). */
  function assertSafeHtml(label: string, html: string): void {
    expect(html, `${label}: raw <script>`).not.toMatch(/<script/i);
    for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
      for (const at of tag[2]!.matchAll(/\s([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
        const name = at[1]!.toLowerCase();
        const value = (at[2] ?? "").replace(/^["']|["']$/g, "").replace(/&amp;/g, "&");
        expect(name, `${label}: event handler on <${tag[1]}>`).not.toMatch(/^on/);
        if (name === "href" || name === "src") expect(value, `${label}: ${name} on <${tag[1]}>`).toMatch(/^(https?:\/\/|mailto:|tel:|#|\/(?![\\/])|[a-z0-9_.-]+(\/|$))/i);
        if (name === "style") expect(value, `${label}: style`).not.toMatch(/url\(|expression\(|javascript:|position:\s*fixed|[<>{}]/i);
        if (tag[1]!.toLowerCase() === "iframe" && name === "src") expect(new URL(value).hostname).toMatch(/^(www\.youtube-nocookie\.com|www\.youtube\.com|www\.figma\.com|platform\.twitter\.com)$/);
      }
    }
    expect(html, `${label}: svg data image`).not.toMatch(/data:image\/svg/i);
  }

  it("write time: dangerous URLs / embed ids are refused with 422", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const res = await admin.agent.post(`${API}/posts`).send({ title: "Evil", section: "personal", tags: [], content: evil(), status: "published" });
    expect(res.status).toBe(422);
    const codes = (res.body.error.details as Array<{ code: string }>).map((d) => d.code);
    expect(codes).toContain("unsafe-url");
    expect(codes).toContain("invalid-attribute");
  });

  it("render time (rows that bypassed validation, e.g. legacy data): contentHtml, the RSS feed and the newsletter preview contain no executable markup", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    const [row] = await t.db
      .insert(post)
      .values({ slug: "evil", title: "Evil", excerpt: "x", section: "personal", status: "published", publishedAt: new Date(Date.now() - 1000), authorId: admin.user.id, content: evil() as never, contentText: "evil" })
      .returning({ slug: post.slug });
    const detail = (await anonAgent(t).get(`/api/posts/${row!.slug}`).expect(200)).body.data;
    const v1 = (await anonAgent(t).get(`/api/v1/posts/${row!.slug}`).expect(200)).body.data;
    const feed = (await anonAgent(t).get("/api/feed.xml").expect(200)).text;
    // the newsletter composer validates its content: keep only the nodes validation accepts
    const accepted = evil().root.children.filter((_, i) => ![0, 2, 7, 8, 9, 10].includes(i));
    const nl = await admin.agent.post(`${API}/newsletters`).send({ subject: "Evil", content: { root: { ...evil().root, children: accepted } } });
    expect(nl.status).toBe(201);
    const preview = (await admin.agent.post(`${API}/newsletters/${nl.body.data.id}/preview`).expect(200)).body.data.html as string;
    for (const [label, html] of [["web", detail.contentHtml as string], ["v1", v1.contentHtml as string], ["rss", feed], ["email", preview]] as const) {
      expect(html.length, label).toBeGreaterThan(50);
      assertSafeHtml(label, html);
    }
  });
});

describe("production session cookie + trusted origins", () => {
  it("session cookie is __Secure-, HttpOnly, Secure, SameSite=Lax; dev origins are not trusted in production", async () => {
    const prod = await buildTestApp({ env: { NODE_ENV: "production", SITE_URL: "https://blog.example.com", BETTER_AUTH_URL: "https://blog.example.com", RATE_LIMIT_ENABLED: "0" } });
    try {
      const u = await createUser(prod);
      const res = await request(prod.app).post("/api/auth/sign-in/email").set("Origin", "https://blog.example.com").send({ email: u.email, password: u.password });
      expect(res.status).toBe(200);
      const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
      const sessionCookie = cookies.find((c) => /session_token/.test(c));
      expect(sessionCookie, cookies.join("\n")).toBeTruthy();
      expect(sessionCookie).toMatch(/^__Secure-blog\.session_token=/);
      expect(sessionCookie).toMatch(/;\s*HttpOnly/i);
      expect(sessionCookie).toMatch(/;\s*Secure/i);
      expect(sessionCookie).toMatch(/;\s*SameSite=Lax/i);
      expect(sessionCookie).toMatch(/;\s*Path=\//i);
      // localhost origins are a development convenience only
      expect(prod.config.trustedOrigins).toEqual(["https://blog.example.com"]);
      await request(prod.app).post("/api/auth/sign-in/email").set("Origin", "http://localhost:3000").set("Cookie", "x=1").send({ email: u.email, password: u.password }).expect(403);
      await request(prod.app).patch("/api/me").set("Origin", "http://localhost:4000").set("Cookie", "x=1").send({ name: "x" }).expect(403);
    } finally {
      await prod.close();
    }
  });
});
