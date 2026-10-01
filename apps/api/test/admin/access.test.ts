import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anonAgent, buildTestApp, signUpAndSignIn, type TestApp } from "../helpers";

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const id = randomUUID();
type Route = [method: "get" | "post" | "patch" | "delete", path: string];

/** Every admin route (SPEC §5.5 + extensions). */
const ROUTES: Route[] = [
  ["get", "/posts"],
  ["post", "/posts"],
  ["get", `/posts/${id}`],
  ["patch", `/posts/${id}`],
  ["delete", `/posts/${id}`],
  ["post", `/posts/${id}/publish`],
  ["post", `/posts/${id}/unpublish`],
  ["post", `/posts/${id}/schedule`],
  ["get", "/media"],
  ["post", "/media"],
  ["patch", `/media/${id}`],
  ["delete", `/media/${id}`],
  ["get", "/users"],
  ["get", "/users/someone"],
  ["patch", "/users/someone"],
  ["post", "/users/someone/ban"],
  ["post", "/users/someone/unban"],
  ["delete", "/users/someone"],
  ["get", "/comments"],
  ["patch", `/comments/${id}`],
  ["post", `/comments/${id}/resolve-reports`],
  ["get", "/newsletters"],
  ["post", "/newsletters"],
  ["get", `/newsletters/${id}`],
  ["patch", `/newsletters/${id}`],
  ["delete", `/newsletters/${id}`],
  ["post", `/newsletters/${id}/preview`],
  ["post", `/newsletters/${id}/test`],
  ["post", `/newsletters/${id}/send`],
  ["post", `/newsletters/${id}/schedule`],
  ["post", `/newsletters/${id}/unschedule`],
  ["get", `/newsletters/${id}/stats`],
  ["get", "/subscribers"],
  ["delete", `/subscribers/${id}`],
  ["post", "/subscribers/sync"],
  ["get", "/api-keys"],
  ["post", "/api-keys"],
  ["delete", `/api-keys/${id}`],
  ["get", "/stats"],
  ["get", "/system"],
  ["post", "/embeddings/reindex"],
];

describe("admin access matrix", () => {
  it("anonymous → 401, reader → 403, admin → passes the gate, on EVERY admin route", async () => {
    const anon = anonAgent(t);
    const reader = (await signUpAndSignIn(t, { role: "reader" })).agent;
    const admin = (await signUpAndSignIn(t, { role: "admin" })).agent;
    for (const [method, path] of ROUTES) {
      const url = `/api/admin${path}`;
      const a = await anon[method](url).send({});
      expect(a.status, `anon ${method} ${path}`).toBe(401);
      expect(a.body.error.code).toBe("unauthorized");
      const r = await reader[method](url).send({});
      expect(r.status, `reader ${method} ${path}`).toBe(403);
      expect(r.body.error.code).toBe("forbidden");
      const ad = await admin[method](url).send({});
      expect([401, 403], `admin ${method} ${path}`).not.toContain(ad.status);
      expect(ad.status, `admin ${method} ${path}`).toBeLessThan(500);
    }
  });

  it("a banned admin is locked out (403)", async () => {
    const s = await signUpAndSignIn(t, { role: "admin" });
    const { user } = await import("@blog/db");
    const { eq } = await import("@blog/db");
    await t.db.update(user).set({ banned: true }).where(eq(user.id, s.user.id));
    await s.agent.get("/api/admin/stats").expect(403);
  });

  it("also answers without the /api prefix", async () => {
    const admin = (await signUpAndSignIn(t, { role: "admin" })).agent;
    await admin.get("/admin/stats").expect(200);
    await anonAgent(t).get("/admin/stats").expect(401);
  });

  it("mutations from an untrusted origin are rejected even for an admin session (CSRF)", async () => {
    const admin = (await signUpAndSignIn(t, { role: "admin" })).agent;
    const res = await admin.post("/api/admin/api-keys").set("Origin", "https://evil.example").send({ name: "x" });
    expect(res.status).toBe(403);
  });
});
