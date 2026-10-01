import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp, type TestApp } from "./helpers";

describe("auth rate limiting (enabled)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp({ env: { RATE_LIMIT_ENABLED: "1" } });
  });
  afterAll(() => t.close());

  it("limits non-GET auth requests to 10/min/IP with the rate_limited envelope", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(t.app).post("/api/auth/sign-in/email").set("Origin", t.origin).send({ email: "nobody@example.com", password: "whatever-password" });
      expect(r.status).toBe(401);
    }
    const blocked = await request(t.app).post("/api/auth/sign-in/email").set("Origin", t.origin).send({ email: "nobody@example.com", password: "whatever-password" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    // reads are not counted against the auth budget
    await request(t.app).get("/api/auth/get-session").expect(200);
  });
});

describe("local media serving", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  it("serves stored images with hardened headers; 404 for unknown / non-image keys", async () => {
    await t.storage.put("2026/pic.png", Buffer.from([137, 80, 78, 71]), { contentType: "image/png" });
    await t.storage.put("evil.html", Buffer.from("<script>alert(1)</script>"), { contentType: "text/html" });
    const res = await request(t.app).get("/api/media/files/2026/pic.png").expect(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toMatch(/immutable/);
    await request(t.app).get("/api/media/files/missing.png").expect(404);
    await request(t.app).get("/api/media/files/evil.html").expect(404);
    await request(t.app).get("/media/files/2026/pic.png").expect(200); // unprefixed mount
  });
});
