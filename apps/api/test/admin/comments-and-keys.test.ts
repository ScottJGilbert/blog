import { and, apiKey, auditLog, comment, commentReport, eq } from "@blog/db";
import { AdminCommentSchema, ApiKeyCreatedSchema, ApiKeySchema, StatsSchema, SystemInfoSchema } from "@blog/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, createUser, type TestApp } from "../helpers";
import { API, adminSession, auditActions, insertComment, insertPost, insertReport, insertSubscriber, type Admin } from "./helpers";
import { API_KEY_FORMAT } from "../../src/services/admin/api-keys";
import { sha256Hex } from "../../src/lib/crypto";

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

describe("comment moderation", () => {
  it("lists with post info, author, reports and open-report counts; filters by status and reported", async () => {
    const author = await createUser(t, { name: "Commenter", email: "c@example.com" });
    const r1 = await createUser(t, { name: "Reporter One" });
    const r2 = await createUser(t, { name: "Reporter Two" });
    const p = await insertPost(t, admin.user.id, { title: "Post T", slug: "post-t", status: "published", publishedAt: new Date() });
    const clean = await insertComment(t, p.id, author.id, { body: "fine" });
    const bad = await insertComment(t, p.id, author.id, { body: "bad one" });
    const hidden = await insertComment(t, p.id, null, { body: "hidden", status: "hidden" });
    await insertReport(t, bad.id, r1.id, "spam spam");
    await insertReport(t, bad.id, r2.id, "abuse");
    const res = await admin.agent.get(`${API}/comments`).expect(200);
    expect(res.body.meta.total).toBe(3);
    for (const c of res.body.data) AdminCommentSchema.parse(c);
    const byId = Object.fromEntries(res.body.data.map((c: any) => [c.id, c]));
    expect(byId[bad.id]).toMatchObject({ openReportCount: 2, post: { slug: "post-t", title: "Post T", section: "engineering" }, author: { email: "c@example.com" } });
    expect(byId[bad.id].reports.map((r: any) => r.reporter.name).sort()).toEqual(["Reporter One", "Reporter Two"]);
    expect(byId[clean.id].reports).toEqual([]);
    expect(byId[hidden.id].author).toBeNull();

    const reported = await admin.agent.get(`${API}/comments?reported=true`).expect(200);
    expect(reported.body.data.map((c: any) => c.id)).toEqual([bad.id]);
    expect((await admin.agent.get(`${API}/comments?status=hidden`)).body.data.map((c: any) => c.id)).toEqual([hidden.id]);
    expect((await admin.agent.get(`${API}/comments?reported=false`)).body.meta.total).toBe(3);
    await admin.agent.get(`${API}/comments?status=nope`).expect(400);
  });

  it("changes status (audited), 404 / 400 on bad input", async () => {
    const p = await insertPost(t, admin.user.id);
    const c = await insertComment(t, p.id, admin.user.id);
    const res = await admin.agent.patch(`${API}/comments/${c.id}`).send({ status: "hidden" }).expect(200);
    expect(res.body.data.status).toBe("hidden");
    await admin.agent.patch(`${API}/comments/${c.id}`).send({ status: "visible" }).expect(200);
    await admin.agent.patch(`${API}/comments/${c.id}`).send({ status: "weird" }).expect(400);
    await admin.agent.patch(`${API}/comments/00000000-0000-4000-8000-000000000000`).send({ status: "hidden" }).expect(404);
    expect(await auditActions(t)).toEqual(["comment.status", "comment.status"]);
  });

  it("resolve-reports sets resolved_at on open reports only", async () => {
    const p = await insertPost(t, admin.user.id);
    const c = await insertComment(t, p.id, admin.user.id);
    const u1 = await createUser(t, {});
    const u2 = await createUser(t, {});
    const old = await insertReport(t, c.id, u1.id);
    const oldDate = new Date("2024-01-01T00:00:00Z");
    await t.db.update(commentReport).set({ resolvedAt: oldDate }).where(eq(commentReport.id, old.id));
    await insertReport(t, c.id, u2.id);
    const res = await admin.agent.post(`${API}/comments/${c.id}/resolve-reports`).expect(200);
    expect(res.body.data.openReportCount).toBe(0);
    const rows = await t.db.select().from(commentReport).where(eq(commentReport.commentId, c.id));
    expect(rows.every((r) => r.resolvedAt !== null)).toBe(true);
    expect(rows.find((r) => r.id === old.id)!.resolvedAt!.toISOString()).toBe(oldDate.toISOString());
    expect((await admin.agent.get(`${API}/comments?reported=true`)).body.data).toEqual([]);
    await admin.agent.post(`${API}/comments/00000000-0000-4000-8000-000000000000/resolve-reports`).expect(404);
    const [e] = await t.db.select().from(auditLog).where(eq(auditLog.action, "comment.resolve_reports"));
    expect(e!.meta).toEqual({ resolved: 1 });
    void comment; void and;
  });
});

describe("api keys", () => {
  it("creates a blg_ key shown once, stores only sha256 + prefix", async () => {
    const res = await admin.agent.post(`${API}/api-keys`).send({ name: "Mobile app", scopes: ["posts:read", "comments:read", "posts:read"] }).expect(201);
    const created = ApiKeyCreatedSchema.parse(res.body.data);
    expect(created.key).toMatch(API_KEY_FORMAT);
    expect(created.key).toHaveLength(47);
    expect(created.prefix).toBe(created.key.slice(0, 8));
    expect(created.scopes).toEqual(["posts:read", "comments:read"]);
    const [row] = await t.db.select().from(apiKey).where(eq(apiKey.id, created.id));
    expect(row!.keyHash).toBe(sha256Hex(created.key));
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect(row!.createdBy).toBe(admin.user.id);

    const list = await admin.agent.get(`${API}/api-keys`).expect(200);
    expect(list.body.data).toHaveLength(1);
    ApiKeySchema.parse(list.body.data[0]);
    expect(JSON.stringify(list.body)).not.toContain(created.key);
    expect(list.body.data[0].key).toBeUndefined();
    // two keys never collide
    const second = await admin.agent.post(`${API}/api-keys`).send({ name: "Second" }).expect(201);
    expect(second.body.data.key).not.toBe(created.key);
    expect(second.body.data.scopes).toEqual([]);
    // audit never contains the key
    const logs = await t.db.select().from(auditLog).where(eq(auditLog.action, "api_key.create"));
    expect(JSON.stringify(logs)).not.toContain(created.key);
  });

  it("validates input", async () => {
    await admin.agent.post(`${API}/api-keys`).send({}).expect(400);
    await admin.agent.post(`${API}/api-keys`).send({ name: "x", scopes: ["admin:all"] }).expect(400);
    await admin.agent.post(`${API}/api-keys`).send({ name: "x".repeat(81) }).expect(400);
  });

  it("revokes (idempotent, row kept), 404 for unknown", async () => {
    const created = (await admin.agent.post(`${API}/api-keys`).send({ name: "Temp" }).expect(201)).body.data;
    await admin.agent.delete(`${API}/api-keys/${created.id}`).expect(204);
    await admin.agent.delete(`${API}/api-keys/${created.id}`).expect(204);
    const list = (await admin.agent.get(`${API}/api-keys`)).body.data;
    expect(list[0].revokedAt).toBeTruthy();
    await admin.agent.delete(`${API}/api-keys/00000000-0000-4000-8000-000000000000`).expect(404);
    expect((await auditActions(t)).filter((a) => a === "api_key.revoke")).toHaveLength(1);
  });
});

describe("stats / system / reindex", () => {
  it("GET /admin/stats matches the shared schema and counts correctly", async () => {
    const u = await createUser(t, {});
    const pub = await insertPost(t, admin.user.id, { title: "P1", status: "published", publishedAt: new Date() });
    await insertPost(t, admin.user.id, { title: "D1", status: "draft" });
    await insertPost(t, admin.user.id, { title: "D2", status: "draft" });
    await insertPost(t, admin.user.id, { title: "S1", status: "scheduled", scheduledFor: new Date(Date.now() + 1e7) });
    const c = await insertComment(t, pub.id, u.id, { body: "x".repeat(300) });
    await insertComment(t, pub.id, null, { body: "anon" });
    await insertReport(t, c.id, admin.user.id);
    await insertSubscriber(t, { email: "a@x.com", status: "confirmed" });
    await insertSubscriber(t, { email: "b@x.com", status: "pending" });
    await insertSubscriber(t, { email: "c@x.com", status: "unsubscribed" });
    const res = await admin.agent.get(`${API}/stats`).expect(200);
    const s = StatsSchema.parse(res.body.data);
    expect(s.posts).toEqual({ published: 1, draft: 2, scheduled: 1 });
    expect(s.comments).toEqual({ total: 2, reported: 1 });
    expect(s.users).toEqual({ total: 2, admins: 1 });
    expect(s.subscribers).toEqual({ confirmed: 1, pending: 1 });
    expect(s.recentPosts).toHaveLength(4);
    expect(s.recentComments).toHaveLength(2);
    expect(s.recentComments.find((x) => x.authorName === "Deleted user")).toBeTruthy();
    expect(s.recentComments.find((x) => x.body.length > 200)!.body.endsWith("…")).toBe(true);
  });

  it("GET /admin/stats works on an empty database", async () => {
    await t.db.delete((await import("@blog/db")).post);
    StatsSchema.parse((await admin.agent.get(`${API}/stats`).expect(200)).body.data);
  });

  it("GET /admin/system reports integrations", async () => {
    const res = await admin.agent.get(`${API}/system`).expect(200);
    expect(SystemInfoSchema.parse(res.body.data)).toEqual({
      db: "up",
      mailer: "memory",
      storage: "memory",
      embeddings: { enabled: false, model: expect.any(String) },
      newsletter: { provider: "noop", configured: false },
      version: expect.any(String),
    });
  });

  it("POST /admin/embeddings/reindex answers 200 {enabled:false} without a provider", async () => {
    const res = await admin.agent.post(`${API}/embeddings/reindex`).expect(200);
    expect(res.body.data).toEqual({ enabled: false, queued: 0 });
  });
});

describe("embeddings reindex with a provider", () => {
  let t2: TestApp;
  beforeAll(async () => {
    t2 = await buildTestApp({
      deps: { embeddings: { enabled: true, model: "m", embed: async (xs: string[]) => xs.map(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))) } },
    });
  });
  afterAll(() => t2.close());

  it("returns 202 with the queued count and audits", async () => {
    const a = await adminSession(t2);
    await insertPost(t2, a.user.id, { status: "published", publishedAt: new Date() });
    await insertPost(t2, a.user.id, { status: "published", publishedAt: new Date() });
    const res = await a.agent.post(`${API}/embeddings/reindex`).expect(202);
    expect(res.body.data).toEqual({ enabled: true, queued: 2 });
    const { waitForReindex } = await import("../../src/services/posts/embeddings");
    await waitForReindex(t2.deps);
    const { postEmbedding } = await import("@blog/db");
    expect(await t2.db.select().from(postEmbedding)).toHaveLength(2);
    const res2 = await a.agent.get(`${API}/system`).expect(200);
    expect(res2.body.data.embeddings).toEqual({ enabled: true, model: "m" });
  });
});
