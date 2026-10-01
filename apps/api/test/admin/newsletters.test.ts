import { auditLog, eq, newsletter, subscriber } from "@blog/db";
import { NewsletterSchema, NewsletterSummarySchema, SendNewsletterResultSchema, SubscriberSchema, SubscriberSyncResultSchema } from "@blog/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../helpers";
import { startFakeListmonk, type FakeListmonk } from "../fakes/listmonk";
import { png } from "../fakes/images";
import { ListmonkProvider } from "../../src/services/newsletter";
import { createLogger } from "../../src/logger";
import { API, adminSession, auditActions, doc, insertNewsletter, insertPost, insertSubscriber, type Admin } from "./helpers";

let lm: FakeListmonk;
let t: TestApp; // listmonk-backed
let noop: TestApp; // no provider
let admin: Admin;
let adminNoop: Admin;

beforeAll(async () => {
  lm = await startFakeListmonk({ user: "blog", token: "tok" });
  const provider = new ListmonkProvider({ url: lm.url, user: "blog", apiToken: "tok", listId: "1" }, createLogger({ logLevel: "silent", isProd: false }), fetch, { backoffMs: 1, retries: 1 });
  t = await buildTestApp({ deps: { newsletter: provider } });
  noop = await buildTestApp();
});
afterAll(async () => {
  await t.close();
  await noop.close();
  await lm.close();
});
beforeEach(async () => {
  lm.reset();
  await t.reset();
  await noop.reset();
  admin = await adminSession(t);
  adminNoop = await adminSession(noop);
});

const create = async (a: Admin = admin, body: Record<string, unknown> = {}) =>
  (await a.agent.post(`${API}/newsletters`).send({ subject: "Monthly news", content: doc("Hello subscribers"), ...body }).expect(201)).body.data as {
    id: string;
    html: string;
    status: string;
    [k: string]: any;
  };

describe("CRUD", () => {
  it("creates a draft with an html snapshot (email document, absolute baseUrl, unsubscribe footer)", async () => {
    const n = await create(admin, { preheader: "Inbox teaser", content: { root: { ...doc("x").root, children: [...doc("Hi").root.children, { type: "image", version: 1, src: "/api/media/files/media/2026/01/x.png", altText: "pic", width: 0, height: 0, maxWidth: 400, showCaption: false }] } } });
    NewsletterSchema.parse(n);
    expect(n).toMatchObject({ status: "draft", subject: "Monthly news", preheader: "Inbox teaser", postId: null, listmonkCampaignId: null, scheduledFor: null, sentAt: null, stats: null });
    expect(n.html).toContain("<!DOCTYPE html>");
    expect(n.html).toContain("Inbox teaser");
    expect(n.html).toContain("{{ UnsubscribeURL }}");
    expect(n.html).toContain("http://localhost:3000/api/media/files/media/2026/01/x.png"); // SITE_URL + relative src
    expect(n.html).toContain("<title>Monthly news</title>");
    expect(await auditActions(t)).toContain("newsletter.create");
  });

  it("escapes go-template delimiters coming from content", async () => {
    const n = await create(admin, { content: doc("evil {{ .Subscriber.Email }} and {{ Track \"x\" }}") });
    const body = n.html.split("{{ UnsubscribeURL }}")[0]!;
    expect(body).not.toContain("{{ .Subscriber");
    expect(body).toContain("&#123;&#123;");
  });

  it("fills a draft from a post: title, cover, body blocks, read-more link; preheader from excerpt", async () => {
    const p = await insertPost(t, admin.user.id, { title: "Great Post", slug: "great-post", section: "personal", excerpt: "The excerpt", status: "published", publishedAt: new Date(), coverImageUrl: "/api/media/files/c.png", coverImageAlt: "cover" });
    const n = await create(admin, { subject: "Read this", postId: p.id, content: undefined });
    expect(n.postId).toBe(p.id);
    expect(n.preheader).toBe("The excerpt");
    expect(n.html).toContain("Great Post");
    expect(n.html).toContain("Seeded body text.");
    expect(n.html).toContain("http://localhost:3000/personal/great-post");
    expect(n.html).toContain("http://localhost:3000/api/media/files/c.png");
    expect(n.content.root.children.length).toBeGreaterThanOrEqual(4);
    await admin.agent.post(`${API}/newsletters`).send({ subject: "x", postId: "00000000-0000-4000-8000-000000000000" }).expect(404);
  });

  it("validates input and content", async () => {
    await admin.agent.post(`${API}/newsletters`).send({}).expect(400);
    await admin.agent.post(`${API}/newsletters`).send({ subject: "" }).expect(400);
    await admin.agent.post(`${API}/newsletters`).send({ subject: "x".repeat(201) }).expect(400);
    const bad = doc("x");
    (bad.root.children[0] as any).children = [{ type: "link", version: 1, url: "javascript:1", children: [], direction: "ltr", format: "", indent: 0 }];
    const res = await admin.agent.post(`${API}/newsletters`).send({ subject: "x", content: bad }).expect(422);
    expect(res.body.error.details[0].code).toBe("unsafe-url");
  });

  it("a blank draft (no content) is allowed but cannot be sent/tested/scheduled", async () => {
    const n = (await admin.agent.post(`${API}/newsletters`).send({ subject: "Draft only" }).expect(201)).body.data;
    expect(n.content).toBeNull();
    expect(n.html).toBe("");
    await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(422);
    await admin.agent.post(`${API}/newsletters/${n.id}/test`).send({ email: "a@example.com" }).expect(422);
    await admin.agent.post(`${API}/newsletters/${n.id}/schedule`).send({ scheduledFor: new Date(Date.now() + 1e6).toISOString() }).expect(422);
    expect((await admin.agent.post(`${API}/newsletters/${n.id}/preview`).expect(200)).body.data.html).toContain("<html");
  });

  it("lists (filter by status, paginate), gets, patches (html regenerated), deletes", async () => {
    const a = await create();
    await create(admin, { subject: "Second" });
    await insertNewsletter(t, { status: "sent", subject: "Old sent" });
    const list = await admin.agent.get(`${API}/newsletters`).expect(200);
    expect(list.body.meta.total).toBe(3);
    for (const x of list.body.data) {
      NewsletterSummarySchema.parse(x);
      expect(x.html).toBeUndefined();
      expect(x.content).toBeUndefined();
    }
    expect((await admin.agent.get(`${API}/newsletters?status=sent`)).body.data.map((x: any) => x.subject)).toEqual(["Old sent"]);
    expect((await admin.agent.get(`${API}/newsletters?pageSize=2&page=2`)).body.data).toHaveLength(1);
    await admin.agent.get(`${API}/newsletters?status=zzz`).expect(400);

    const got = await admin.agent.get(`${API}/newsletters/${a.id}`).expect(200);
    expect(got.body.data.html).toBe(a.html);
    const patched = await admin.agent.patch(`${API}/newsletters/${a.id}`).send({ subject: "Changed subject", content: doc("Brand new body") }).expect(200);
    expect(patched.body.data.html).toContain("Brand new body");
    expect(patched.body.data.html).toContain("<title>Changed subject</title>");
    expect(patched.body.data.html).not.toContain("Hello subscribers");
    const pre = await admin.agent.patch(`${API}/newsletters/${a.id}`).send({ preheader: "now with teaser" }).expect(200);
    expect(pre.body.data.html).toContain("now with teaser");
    expect(pre.body.data.preheader).toBe("now with teaser");
    const cleared = await admin.agent.patch(`${API}/newsletters/${a.id}`).send({ preheader: null }).expect(200);
    expect(cleared.body.data.preheader).toBeNull();
    await admin.agent.patch(`${API}/newsletters/${a.id}`).send({ subject: "" }).expect(400);

    await admin.agent.delete(`${API}/newsletters/${a.id}`).expect(204);
    await admin.agent.get(`${API}/newsletters/${a.id}`).expect(404);
    await admin.agent.delete(`${API}/newsletters/${a.id}`).expect(404);
    await admin.agent.get(`${API}/newsletters/garbage`).expect(404);
    expect(await auditActions(t)).toEqual(expect.arrayContaining(["newsletter.update", "newsletter.delete"]));
  });

  it("sent and sending newsletters cannot be edited; sending ones cannot be deleted", async () => {
    const sent = await insertNewsletter(t, { status: "sent" });
    const sending = await insertNewsletter(t, { status: "sending" });
    await admin.agent.patch(`${API}/newsletters/${sent.id}`).send({ subject: "no" }).expect(409);
    await admin.agent.patch(`${API}/newsletters/${sending.id}`).send({ subject: "no" }).expect(409);
    await admin.agent.delete(`${API}/newsletters/${sending.id}`).expect(409);
    await admin.agent.delete(`${API}/newsletters/${sent.id}`).expect(204);
  });
});

describe("preview", () => {
  it("returns html with listmonk tags replaced by inert anchors (stored snapshot keeps them)", async () => {
    const n = await create();
    const res = await admin.agent.post(`${API}/newsletters/${n.id}/preview`).expect(200);
    expect(res.body.data.html).toContain("Hello subscribers");
    expect(res.body.data.html).not.toContain("{{");
    expect(res.body.data.html).toContain("#unsubscribe");
    expect((await admin.agent.get(`${API}/newsletters/${n.id}`)).body.data.html).toContain("{{ UnsubscribeURL }}");
    await admin.agent.post(`${API}/newsletters/00000000-0000-4000-8000-000000000000/preview`).expect(404);
  });
});

describe("test send", () => {
  it("sends one test copy via the provider to the given address", async () => {
    const n = await create();
    const res = await admin.agent.post(`${API}/newsletters/${n.id}/test`).send({ email: "Me@Example.com" }).expect(200);
    expect(res.body.data).toEqual({ sent: true, provider: "listmonk", warning: null });
    expect(lm.tests).toHaveLength(1);
    expect(lm.tests[0]!.subscribers).toEqual(["me@example.com"]);
    expect(lm.tests[0]!.body.subject).toBe("[Test] Monthly news");
    expect(lm.tests[0]!.body.body).toContain("Hello subscribers");
    expect(lm.campaigns).toHaveLength(0); // a test never creates a campaign
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "newsletter.test"));
    expect(JSON.stringify(entry!.meta)).not.toContain("me@example.com"); // masked
    expect((await admin.agent.get(`${API}/newsletters/${n.id}`)).body.data.status).toBe("draft");
  });

  it("validates the address and reports provider failures as 502", async () => {
    const n = await create();
    await admin.agent.post(`${API}/newsletters/${n.id}/test`).send({ email: "not-an-email" }).expect(400);
    await admin.agent.post(`${API}/newsletters/${n.id}/test`).send({}).expect(400);
    lm.failNext("POST /api/campaigns/0/test", 500, 5);
    const res = await admin.agent.post(`${API}/newsletters/${n.id}/test`).send({ email: "a@example.com" }).expect(502);
    expect(res.body.error.message).toMatch(/could not send the test/);
  });

  it("without a provider answers 200 with a warning and sends nothing", async () => {
    const n = await create(adminNoop);
    const res = await adminNoop.agent.post(`${API}/newsletters/${n.id}/test`).send({ email: "a@example.com" }).expect(200);
    expect(res.body.data).toMatchObject({ sent: false, provider: "noop", warning: expect.stringMatching(/not configured/) });
  });

  it("is rate limited per admin (5/min) when limiting is enabled", async () => {
    const limited = await buildTestApp({ env: { RATE_LIMIT_ENABLED: "1" } });
    try {
      const a = await adminSession(limited);
      const n = (await a.agent.post(`${API}/newsletters`).send({ subject: "x", content: doc("y") }).expect(201)).body.data;
      for (let i = 0; i < 5; i++) await a.agent.post(`${API}/newsletters/${n.id}/test`).send({ email: "a@example.com" }).expect(200);
      const blocked = await a.agent.post(`${API}/newsletters/${n.id}/test`).send({ email: "a@example.com" }).expect(429);
      expect(blocked.body.error.code).toBe("rate_limited");
    } finally {
      await limited.close();
    }
  });
});

describe("send", () => {
  it("creates + starts a campaign, marks the newsletter sent with campaign id and stats; idempotent", async () => {
    const n = await create(admin, { preheader: "teaser" });
    const res = await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    const result = SendNewsletterResultSchema.parse(res.body.data);
    expect(result.provider).toBe("listmonk");
    expect(result.warning).toBeNull();
    expect(result.newsletter).toMatchObject({ status: "sent", listmonkCampaignId: 1 });
    expect(result.newsletter.sentAt).toBeTruthy();
    expect(result.newsletter.stats).toMatchObject({ toSend: 0, status: "running" });
    expect(lm.campaigns).toHaveLength(1);
    expect(lm.campaigns[0]).toMatchObject({ subject: "Monthly news", status: "running", content_type: "html", lists: [{ id: 1 }] });
    expect(lm.campaigns[0]!.body).toContain("Hello subscribers");
    expect(lm.campaigns[0]!.body).toContain("{{ UnsubscribeURL }}");

    // second send: same result, no second campaign
    const again = await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    expect(again.body.data.newsletter.status).toBe("sent");
    expect(again.body.data.warning).toBeNull();
    expect(lm.campaigns).toHaveLength(1);
    expect(lm.count("POST /api/campaigns")).toBe(1);
    expect(await auditActions(t)).toContain("newsletter.send");
    // a sent newsletter cannot be scheduled / edited
    await admin.agent.post(`${API}/newsletters/${n.id}/schedule`).send({ scheduledFor: new Date(Date.now() + 1e6).toISOString() }).expect(409);
    await admin.agent.patch(`${API}/newsletters/${n.id}`).send({ subject: "x" }).expect(409);
  });

  it("two concurrent sends create exactly one campaign", async () => {
    const n = await create();
    const [a, b] = await Promise.all([admin.agent.post(`${API}/newsletters/${n.id}/send`), admin.agent.post(`${API}/newsletters/${n.id}/send`)]);
    expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
    expect(lm.campaigns).toHaveLength(1);
    expect((await admin.agent.get(`${API}/newsletters/${n.id}`)).body.data.status).toBe("sent");
  });

  it("a 'sending' newsletter answers 409", async () => {
    const n = await insertNewsletter(t, { status: "sending" });
    await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(409);
  });

  it("without a provider: 200 + warning, provider noop, NOT marked sent", async () => {
    const n = await create(adminNoop);
    const res = await adminNoop.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    const result = SendNewsletterResultSchema.parse(res.body.data);
    expect(result.provider).toBe("noop");
    expect(result.warning).toMatch(/not configured/);
    expect(result.newsletter.status).toBe("draft");
    expect(result.newsletter.sentAt).toBeNull();
    expect((await adminNoop.agent.get(`${API}/newsletters/${n.id}`)).body.data.status).toBe("draft");
  });

  it("provider 500 → newsletter 'failed' with the error recorded (HTTP 200 + warning); a retry succeeds without duplicates", async () => {
    const n = await create();
    lm.failNext("POST /api/campaigns", 500, 1);
    const res = await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    expect(res.body.data.newsletter.status).toBe("failed");
    expect(res.body.data.newsletter.stats.error).toMatch(/500/);
    expect(res.body.data.warning).toMatch(/Sending failed/);
    expect(res.body.data.newsletter.sentAt).toBeNull();
    expect(lm.campaigns).toHaveLength(0);
    expect(await auditActions(t)).toContain("newsletter.send_failed");

    // failed newsletters are editable and can be re-sent
    await admin.agent.patch(`${API}/newsletters/${n.id}`).send({ subject: "Fixed subject" }).expect(200);
    const retry = await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    expect(retry.body.data.newsletter.status).toBe("sent");
    expect(retry.body.data.newsletter.stats.error).toBeUndefined();
    expect(lm.campaigns).toHaveLength(1);
    expect(lm.campaigns[0]!.subject).toBe("Fixed subject");
  });

  it("when only starting the campaign failed, the retry starts the SAME campaign (no duplicate)", async () => {
    const n = await create();
    lm.failNext("PUT /api/campaigns/1/status", 500, 5);
    const res = await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    expect(res.body.data.newsletter).toMatchObject({ status: "failed", listmonkCampaignId: 1 });
    lm.reset(); // clears failures AND state, so recreate the campaign the failed attempt left behind
    lm.campaigns.push({ id: 1, name: "x", subject: "s", body: "b", content_type: "html", type: "regular", messenger: "email", template_id: null, status: "draft", lists: [{ id: 1 }], to_send: 0, sent: 0, views: 0, clicks: 0, bounces: 0 });
    const retry = await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    expect(retry.body.data.newsletter).toMatchObject({ status: "sent", listmonkCampaignId: 1 });
    expect(lm.count("POST /api/campaigns")).toBe(0);
    expect(lm.campaigns[0]!.status).toBe("running");
  });

  it("an unreachable provider is reported the same way", async () => {
    const dead = new ListmonkProvider({ url: "http://127.0.0.1:1", user: "u", apiToken: "t", listId: "1" }, createLogger({ logLevel: "silent", isProd: false }), fetch, { backoffMs: 1, retries: 0 });
    const app = await buildTestApp({ deps: { newsletter: dead } });
    try {
      const a = await adminSession(app);
      const n = await create(a);
      const res = await a.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
      expect(res.body.data.newsletter.status).toBe("failed");
      expect(res.body.data.newsletter.stats.error).toMatch(/could not be reached/);
    } finally {
      await app.close();
    }
  });
});

describe("schedule / unschedule", () => {
  it("schedules for the future (status scheduled), rejects past dates and bad input, can be unscheduled", async () => {
    const n = await create();
    const when = new Date(Date.now() + 3_600_000).toISOString();
    const res = await admin.agent.post(`${API}/newsletters/${n.id}/schedule`).send({ scheduledFor: when }).expect(200);
    expect(NewsletterSchema.parse(res.body.data)).toMatchObject({ status: "scheduled", scheduledFor: when });
    await admin.agent.post(`${API}/newsletters/${n.id}/schedule`).send({ scheduledFor: new Date(Date.now() - 1000).toISOString() }).expect(422);
    await admin.agent.post(`${API}/newsletters/${n.id}/schedule`).send({ scheduledFor: "soon" }).expect(400);
    const un = await admin.agent.post(`${API}/newsletters/${n.id}/unschedule`).expect(200);
    expect(un.body.data).toMatchObject({ status: "draft", scheduledFor: null });
    await admin.agent.post(`${API}/newsletters/${n.id}/unschedule`).expect(409);
    expect(await auditActions(t)).toEqual(expect.arrayContaining(["newsletter.schedule", "newsletter.unschedule"]));
  });

  it("is refused without a configured provider", async () => {
    const n = await create(adminNoop);
    await adminNoop.agent.post(`${API}/newsletters/${n.id}/schedule`).send({ scheduledFor: new Date(Date.now() + 1e6).toISOString() }).expect(409);
  });
});

describe("stats", () => {
  it("pulls campaign stats from the provider and caches them", async () => {
    const n = await create();
    await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    lm.setCampaignStats(1, { sent: 50, to_send: 60, views: 20, clicks: 5, bounces: 1 });
    const res = await admin.agent.get(`${API}/newsletters/${n.id}/stats`).expect(200);
    expect(res.body.data).toMatchObject({ sent: 50, toSend: 60, views: 20, clicks: 5, bounces: 1, status: "running" });
    const [row] = await t.db.select().from(newsletter).where(eq(newsletter.id, n.id));
    expect(row!.stats).toMatchObject({ sent: 50, views: 20 });
  });

  it("falls back to cached stats (stale: true) when the provider fails; {} for unsent newsletters", async () => {
    const n = await create();
    expect((await admin.agent.get(`${API}/newsletters/${n.id}/stats`).expect(200)).body.data).toEqual({});
    await admin.agent.post(`${API}/newsletters/${n.id}/send`).expect(200);
    lm.failNext("GET /api/campaigns/1", 500, 10);
    const res = await admin.agent.get(`${API}/newsletters/${n.id}/stats`).expect(200);
    expect(res.body.data).toMatchObject({ stale: true, error: expect.any(String) });
  });
});

describe("subscribers", () => {
  it("lists with status/email filters and pagination", async () => {
    await insertSubscriber(t, { email: "a@example.com", status: "confirmed" });
    await insertSubscriber(t, { email: "b@corp.test", status: "pending" });
    await insertSubscriber(t, { email: "c@example.com", status: "unsubscribed" });
    const all = await admin.agent.get(`${API}/subscribers`).expect(200);
    expect(all.body.meta.total).toBe(3);
    for (const s of all.body.data) {
      SubscriberSchema.parse(s);
      expect(s.unsubscribeToken).toBeUndefined();
      expect(s.confirmToken).toBeUndefined();
    }
    expect((await admin.agent.get(`${API}/subscribers?status=pending`)).body.data.map((s: any) => s.email)).toEqual(["b@corp.test"]);
    expect((await admin.agent.get(`${API}/subscribers?q=EXAMPLE`)).body.meta.total).toBe(2);
    expect((await admin.agent.get(`${API}/subscribers?pageSize=2&page=2`)).body.data).toHaveLength(1);
    await admin.agent.get(`${API}/subscribers?status=x`).expect(400);
  });

  it("delete removes the row and erases the subscriber at the provider", async () => {
    const s = await insertSubscriber(t, { email: "gone@example.com", status: "confirmed", listmonkSubscriberId: 1 });
    lm.subscribers.push({ id: 1, email: "gone@example.com", name: "g", status: "enabled", attribs: {}, lists: [] });
    await admin.agent.delete(`${API}/subscribers/${s.id}`).expect(204);
    expect(lm.subscribers).toHaveLength(0);
    expect(await t.db.select().from(subscriber)).toHaveLength(0);
    await admin.agent.delete(`${API}/subscribers/${s.id}`).expect(404);
  });

  it("delete still succeeds locally when the provider is down (audited with the error)", async () => {
    const s = await insertSubscriber(t, { email: "x@example.com", status: "confirmed", listmonkSubscriberId: 9 });
    lm.failNext("DELETE /api/subscribers/9", 500, 10);
    await admin.agent.delete(`${API}/subscribers/${s.id}`).expect(204);
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "subscriber.delete"));
    expect((entry!.meta as any).providerError).toBeTruthy();
  });

  it("sync upserts confirmed subscribers, blocklists unsubscribed ones, and is idempotent", async () => {
    const a = await insertSubscriber(t, { email: "a@example.com", status: "confirmed" });
    await insertSubscriber(t, { email: "b@example.com", status: "confirmed" });
    await insertSubscriber(t, { email: "pending@example.com", status: "pending" });
    const un = await insertSubscriber(t, { email: "u@example.com", status: "unsubscribed", listmonkSubscriberId: 77 });
    lm.subscribers.push({ id: 77, email: "u@example.com", name: "u", status: "enabled", attribs: {}, lists: [{ id: 1, name: "l", subscription_status: "confirmed" }] });

    const res = await admin.agent.post(`${API}/subscribers/sync`).expect(200);
    expect(SubscriberSyncResultSchema.parse(res.body.data)).toEqual({ providerConfigured: true, synced: 3, failed: 0 });
    expect(lm.subscribers.find((s) => s.email === "a@example.com")!.lists.map((l) => l.id)).toEqual([1]);
    expect(lm.subscribers.find((s) => s.email === "pending@example.com")).toBeUndefined();
    expect(lm.subscribers.find((s) => s.email === "u@example.com")!.status).toBe("blocklisted");
    const [rowA] = await t.db.select().from(subscriber).where(eq(subscriber.id, a.id));
    expect(rowA!.listmonkSubscriberId).toBeGreaterThan(0);
    const [rowU] = await t.db.select().from(subscriber).where(eq(subscriber.id, un.id));
    expect(rowU!.listmonkSubscriberId).toBeNull();

    // second run: confirmed ones are upserted again (idempotent, 409 path), unsubscribed one is skipped
    const before = lm.subscribers.length;
    const res2 = await admin.agent.post(`${API}/subscribers/sync`).expect(200);
    expect(res2.body.data).toEqual({ providerConfigured: true, synced: 2, failed: 0 });
    expect(lm.subscribers).toHaveLength(before);
    expect(await auditActions(t)).toContain("subscriber.sync");
  });

  it("sync counts failures without aborting", async () => {
    await insertSubscriber(t, { email: "a@example.com", status: "confirmed" });
    await insertSubscriber(t, { email: "b@example.com", status: "confirmed" });
    lm.failNext("POST /api/subscribers", 400, 1);
    const res = await admin.agent.post(`${API}/subscribers/sync`).expect(200);
    expect(res.body.data.synced + res.body.data.failed).toBe(2);
    expect(res.body.data.failed).toBe(1);
  });

  it("sync without a provider reports providerConfigured:false", async () => {
    const res = await adminNoop.agent.post(`${API}/subscribers/sync`).expect(200);
    expect(res.body.data).toEqual({ providerConfigured: false, synced: 0, failed: 0 });
  });
});

void png;
