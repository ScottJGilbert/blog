import { eq, user, comment, post, subscriber } from "@blog/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { anonAgent, buildTestApp, createUser, signUpAndSignIn, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("health + mounting", () => {
  it("GET /api/health reports db up (and answers without the /api prefix too)", async () => {
    const a = await request(t.app).get("/api/health").expect(200);
    expect(a.body).toEqual({ status: "ok", db: "up", version: expect.any(String) });
    expect(a.headers["x-request-id"]).toBeTruthy();
    const b = await request(t.app).get("/health").expect(200);
    expect(b.body.db).toBe("up");
  });

  it("echoes a sane inbound x-request-id and replaces junk", async () => {
    const ok = await request(t.app).get("/api/health").set("x-request-id", "abc-12345678");
    expect(ok.headers["x-request-id"]).toBe("abc-12345678");
    const bad = await request(t.app).get("/api/health").set("x-request-id", "x y\tz");
    expect(bad.headers["x-request-id"]).not.toBe("x y\tz");
  });

  it("sets security headers and does not advertise express", async () => {
    const res = await request(t.app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("Better Auth answers under /api/auth and /auth", async () => {
    const a = await request(t.app).get("/api/auth/get-session").expect(200);
    const b = await request(t.app).get("/auth/get-session").expect(200);
    expect(a.body).toEqual(b.body);
  });
});

describe("error envelope", () => {
  it("404 for unknown routes", async () => {
    const res = await request(t.app).get("/api/does-not-exist").expect(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("400 validation_error with zod issues as details", async () => {
    const s = await signUpAndSignIn(t);
    const res = await s.agent.patch("/api/me").send({}).expect(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    const res2 = await s.agent.patch("/api/me").send({ name: "" }).expect(400);
    expect(res2.body.error.details[0].path).toEqual(["name"]);
  });

  it("400 on malformed JSON, 413 on oversized bodies", async () => {
    const s = await signUpAndSignIn(t);
    const bad = await s.agent.patch("/api/me").set("content-type", "application/json").send("{nope").expect(400);
    expect(bad.body.error.code).toBe("validation_error");
    const big = await s.agent.patch("/api/me").send({ name: "x".repeat(1_200_000) }).expect(413);
    expect(big.body.error.code).toBe("validation_error");
  });
});

describe("auth middleware", () => {
  it("/api/admin: 401 anonymous, 403 reader, passes for admin (stub router ⇒ 404)", async () => {
    const anon = await anonAgent(t).get("/api/admin/stats").expect(401);
    expect(anon.body.error.code).toBe("unauthorized");
    const reader = await signUpAndSignIn(t, { role: "reader" });
    const forbidden = await reader.agent.get("/api/admin/stats").expect(403);
    expect(forbidden.body.error.code).toBe("forbidden");
    const admin = await signUpAndSignIn(t, { role: "admin" });
    await admin.agent.get("/api/admin/stats").expect(404); // not implemented in the skeleton, but authorised
  });

  it("banned admin is locked out", async () => {
    const admin = await signUpAndSignIn(t, { role: "admin" });
    await t.db.update(user).set({ banned: true }).where(eq(user.id, admin.user.id));
    await admin.agent.get("/api/admin/stats").expect(403);
  });
});

describe("CSRF origin check", () => {
  it("blocks cookie-authenticated writes from foreign or missing origins", async () => {
    const s = await signUpAndSignIn(t);
    const evil = await s.agent.patch("/api/me").set("Origin", "https://evil.example").send({ name: "Hacked" }).expect(403);
    expect(evil.body.error.code).toBe("forbidden");
    // no Origin and no Referer at all
    await request(t.app).patch("/api/me").set("Cookie", (await cookieOf(s.agent))).send({ name: "x" }).expect(403);
    // allowed origin via Referer
    await request(t.app)
      .patch("/api/me")
      .set("Cookie", await cookieOf(s.agent))
      .set("Referer", `${t.origin}/account`)
      .send({ name: "Fine" })
      .expect(200);
    const [row] = await t.db.select().from(user).where(eq(user.id, s.user.id));
    expect(row!.name).toBe("Fine");
  });

  it("lets cookie-less and API-key requests through, and never blocks reads", async () => {
    // cookie-less write is not CSRF-able: reaches the auth guard (401) instead of being blocked
    await request(t.app).patch("/api/me").set("Origin", "https://evil.example").send({ name: "x" }).expect(401);
    await request(t.app).patch("/api/me").set("Cookie", "a=b").set("x-api-key", "blg_xxx").send({ name: "x" }).expect(401);
    await request(t.app).get("/api/health").set("Origin", "https://evil.example").set("Cookie", "a=b").expect(200);
  });
});

async function cookieOf(agent: ReturnType<typeof anonAgent>): Promise<string> {
  // supertest agents keep a cookie jar; read it back for requests made outside the agent
  const jar = (agent as unknown as { jar: { getCookies: (a: { domain: string; path: string; secure: boolean; script: boolean }) => { name: string; value: string }[] } }).jar;
  return jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false }).map((c) => `${c.name}=${c.value}`).join("; ");
}

describe("CORS", () => {
  it("allows any origin only on /api/v1 (GET), not elsewhere", async () => {
    const v1 = await request(t.app).get("/api/v1/posts").set("Origin", "https://example.org");
    expect(v1.headers["access-control-allow-origin"]).toBe("*");
    const pre = await request(t.app).options("/api/v1/posts").set("Origin", "https://example.org").set("Access-Control-Request-Method", "GET");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-methods"]).toMatch(/GET/);
    expect(pre.headers["access-control-allow-methods"]).not.toMatch(/POST/);
    const other = await request(t.app).get("/api/health").set("Origin", "https://example.org");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("/api/me", () => {
  it("returns the profile incl. subscription status; PATCH updates name/image", async () => {
    const s = await signUpAndSignIn(t, { name: "Ada" });
    await t.db.insert(subscriber).values({ email: s.email, userId: s.user.id, status: "confirmed", unsubscribeToken: "tok-1" });
    const me = await s.agent.get("/api/me").expect(200);
    expect(me.body.data).toEqual({
      id: s.user.id, name: "Ada", email: s.email, image: null, role: "reader", emailVerified: true, subscription: { status: "confirmed" },
    });
    const patched = await s.agent.patch("/api/me").send({ name: "Ada L.", image: "https://example.com/a.png" }).expect(200);
    expect(patched.body.data).toMatchObject({ name: "Ada L.", image: "https://example.com/a.png" });
    await s.agent.patch("/api/me").send({ image: "javascript:alert(1)" }).expect(400);
  });

  it("DELETE anonymises: comments stay as [deleted], credentials and sessions go", async () => {
    const s = await signUpAndSignIn(t);
    const author = await createUser(t, { role: "admin" });
    const [p] = await t.db
      .insert(post)
      .values({ slug: "p", title: "P", section: "personal", content: { root: { type: "root", children: [] } }, authorId: author.id })
      .returning();
    await t.db.insert(comment).values({ postId: p!.id, authorId: s.user.id, body: "my words" });
    await s.agent.delete("/api/me").expect(204);
    const [c] = await t.db.select().from(comment);
    expect(c).toMatchObject({ body: "[deleted]", status: "deleted", authorId: null });
    const [u] = await t.db.select().from(user).where(eq(user.id, s.user.id));
    expect(u!.name).toBe("Deleted user");
    expect(u!.email).not.toBe(s.email);
    await s.agent.get("/api/me").expect(401);
    await anonAgent(t).post("/api/auth/sign-in/email").send({ email: s.email, password: s.password }).expect(401);
  });

  it("admins cannot delete themselves", async () => {
    const a = await signUpAndSignIn(t, { role: "admin" });
    await a.agent.delete("/api/me").expect(403);
  });
});
