import { eq, auditLog, newsletter, post } from "@blog/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildTestApp, type TestApp } from "../helpers";
import { startFakeListmonk, type FakeListmonk } from "../fakes/listmonk";
import { ListmonkProvider } from "../../src/services/newsletter";
import { createLogger } from "../../src/logger";
import { adminSession, insertNewsletter, insertPost, type Admin } from "./helpers";
import { publishDuePosts } from "../../src/services/admin/scheduled";
import { createNewsletterService } from "../../src/services/newsletter/service";

const SECRET = "cron-secret-cron-secret";
const revalidate = vi.fn(async (_t: string[]) => undefined);
const embed = vi.fn(async (xs: string[]) => xs.map(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))));

let lm: FakeListmonk;
let t: TestApp;
let admin: Admin;
const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 3_600_000);
const auth = { authorization: `Bearer ${SECRET}` };

beforeAll(async () => {
  lm = await startFakeListmonk({ user: "blog", token: "tok" });
  const provider = new ListmonkProvider({ url: lm.url, user: "blog", apiToken: "tok", listId: "1" }, createLogger({ logLevel: "silent", isProd: false }), fetch, { backoffMs: 1, retries: 0 });
  t = await buildTestApp({ env: { CRON_SECRET: SECRET }, deps: { newsletter: provider, revalidate, embeddings: { enabled: true, model: "m", embed } } });
});
afterAll(async () => {
  await t.close();
  await lm.close();
});
beforeEach(async () => {
  lm.reset();
  await t.reset();
  revalidate.mockClear();
  embed.mockClear();
  admin = await adminSession(t);
});

describe("auth", () => {
  it("401 without or with a wrong secret, for GET and POST, with and without the /api prefix", async () => {
    for (const path of ["/api/cron/publish-scheduled", "/cron/publish-scheduled"]) {
      await request(t.app).post(path).expect(401);
      await request(t.app).get(path).expect(401);
      await request(t.app).post(path).set("authorization", "Bearer wrong").expect(401);
      await request(t.app).post(path).set("authorization", SECRET).expect(401);
      await request(t.app).post(path).set("authorization", `Bearer ${SECRET}x`).expect(401);
      await request(t.app).get(path).set(auth).expect(200);
      await request(t.app).post(path).set(auth).expect(200);
    }
  });

  it("a session cookie is not enough (admin session without the secret → 401)", async () => {
    await admin.agent.post("/api/cron/publish-scheduled").expect(401);
  });

  it("503 when CRON_SECRET is unset in production, 401 elsewhere", async () => {
    const prod = await buildTestApp({ env: { NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(40), LOG_LEVEL: "silent" } });
    try {
      const res = await request(prod.app).post("/api/cron/publish-scheduled").set(auth).expect(503);
      expect(res.body.error.code).toBe("internal");
    } finally {
      await prod.close();
    }
    const dev = await buildTestApp();
    try {
      await request(dev.app).post("/api/cron/publish-scheduled").set(auth).expect(401);
    } finally {
      await dev.close();
    }
  });
});

describe("scheduled posts", () => {
  it("publishes due posts (published_at = scheduled_for, scheduled_for cleared), leaves future ones, revalidates + embeds", async () => {
    const dueAt = past();
    const due = await insertPost(t, admin.user.id, { slug: "due", status: "scheduled", scheduledFor: dueAt, section: "personal" });
    const later = await insertPost(t, admin.user.id, { slug: "later", status: "scheduled", scheduledFor: future() });
    const draft = await insertPost(t, admin.user.id, { slug: "draft", status: "draft" });
    const res = await request(t.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data.posts).toEqual({ published: 1, slugs: ["due"] });
    const [row] = await t.db.select().from(post).where(eq(post.id, due.id));
    expect(row).toMatchObject({ status: "published", scheduledFor: null });
    expect(row!.publishedAt!.getTime()).toBe(dueAt.getTime());
    expect((await t.db.select().from(post).where(eq(post.id, later.id)))[0]!.status).toBe("scheduled");
    expect((await t.db.select().from(post).where(eq(post.id, draft.id)))[0]!.status).toBe("draft");
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.mock.calls[0]![0]).toEqual(expect.arrayContaining(["posts", "post:due", "section:personal"]));
    expect(embed).toHaveBeenCalledTimes(1);
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "post.publish_scheduled"));
    expect(entry).toMatchObject({ targetId: due.id, actorId: null });
  });

  it("is idempotent: a second run does nothing", async () => {
    await insertPost(t, admin.user.id, { status: "scheduled", scheduledFor: past() });
    await request(t.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
    revalidate.mockClear();
    const again = await request(t.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
    expect(again.body.data.posts).toEqual({ published: 0, slugs: [] });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("concurrent invocations publish every post exactly once", async () => {
    for (let i = 0; i < 6; i++) await insertPost(t, admin.user.id, { slug: `c${i}`, status: "scheduled", scheduledFor: past() });
    const results = await Promise.all(Array.from({ length: 4 }, () => publishDuePosts(t.deps)));
    expect(results.reduce((n, r) => n + r.published, 0)).toBe(6);
    const rows = await t.db.select().from(post);
    expect(rows.every((r) => r.status === "published" && r.publishedAt && !r.scheduledFor)).toBe(true);
    const logs = await t.db.select().from(auditLog).where(eq(auditLog.action, "post.publish_scheduled"));
    expect(logs).toHaveLength(6);
  });

  it("a post scheduled through the admin API is picked up once its time has come (fake clock)", async () => {
    const p = (await admin.agent.post("/api/admin/posts").send({ title: "Timed", section: "personal", tags: [], content: { root: { type: "root", children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "hi", format: 0, style: "", mode: "normal", detail: 0 }] }] } } }).expect(201)).body.data;
    await admin.agent.post(`/api/admin/posts/${p.id}/schedule`).send({ scheduledFor: new Date(Date.now() + 120_000).toISOString() }).expect(200);
    expect((await publishDuePosts(t.deps)).published).toBe(0);
    const later = { ...t.deps, now: () => new Date(Date.now() + 180_000) };
    expect((await publishDuePosts(later)).published).toBe(1);
  });
});

describe("scheduled newsletters", () => {
  it("sends due newsletters through the provider, once", async () => {
    const due = await insertNewsletter(t, { subject: "Due", status: "scheduled", scheduledFor: past() });
    const later = await insertNewsletter(t, { subject: "Later", status: "scheduled", scheduledFor: future() });
    const res = await request(t.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
    expect(res.body.data.newsletters).toEqual({ sent: 1, failed: 0, interrupted: 0 });
    const [row] = await t.db.select().from(newsletter).where(eq(newsletter.id, due.id));
    expect(row).toMatchObject({ status: "sent", listmonkCampaignId: 1 });
    expect(row!.sentAt).toBeTruthy();
    expect((await t.db.select().from(newsletter).where(eq(newsletter.id, later.id)))[0]!.status).toBe("scheduled");
    expect(lm.campaigns).toHaveLength(1);
    expect(lm.campaigns[0]!.subject).toBe("Due");
    await request(t.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
    expect(lm.campaigns).toHaveLength(1);
  });

  it("concurrent runs never send twice; sending newsletters are skipped", async () => {
    await insertNewsletter(t, { subject: "A", status: "scheduled", scheduledFor: past() });
    await insertNewsletter(t, { subject: "Busy", status: "sending", scheduledFor: past() });
    const svc = createNewsletterService(t.deps);
    const out = await Promise.all([svc.sendDue(), svc.sendDue(), svc.sendDue()]);
    expect(out.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(lm.campaigns).toHaveLength(1);
    expect((await t.db.select().from(newsletter).where(eq(newsletter.subject, "Busy")))[0]!.status).toBe("sending");
  });

  it("provider failure marks the newsletter failed and the run still answers 200", async () => {
    const n = await insertNewsletter(t, { status: "scheduled", scheduledFor: past() });
    lm.failNext("POST /api/campaigns", 500, 1);
    const res = await request(t.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
    expect(res.body.data.newsletters.failed).toBe(1);
    const [row] = await t.db.select().from(newsletter).where(eq(newsletter.id, n.id));
    expect(row!.status).toBe("failed");
    expect((row!.stats as any).error).toMatch(/500/);
  });

  it("stale 'sending' newsletters (crashed run) become failed so they can be retried", async () => {
    const stuck = await insertNewsletter(t, { status: "sending" });
    await t.db.update(newsletter).set({ updatedAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(newsletter.id, stuck.id));
    const res = await request(t.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
    expect(res.body.data.newsletters.interrupted).toBe(1);
    expect((await t.db.select().from(newsletter).where(eq(newsletter.id, stuck.id)))[0]!.status).toBe("failed");
  });

  it("without a provider due newsletters are left scheduled and reported as skipped", async () => {
    const noop = await buildTestApp({ env: { CRON_SECRET: SECRET } });
    try {
      const a = await adminSession(noop);
      const n = await insertNewsletter(noop, { status: "scheduled", scheduledFor: past(), createdBy: a.user.id });
      const res = await request(noop.app).post("/api/cron/publish-scheduled").set(auth).expect(200);
      expect(res.body.data.newsletters).toMatchObject({ sent: 0, skipped: expect.stringMatching(/not configured/) });
      expect((await noop.db.select().from(newsletter).where(eq(newsletter.id, n.id)))[0]!.status).toBe("scheduled");
    } finally {
      await noop.close();
    }
  });
});
