import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ListmonkError, ListmonkProvider } from "../../src/services/newsletter";
import { createNewsletterProvider, NoopProvider } from "../../src/services/newsletter";
import { loadConfig } from "../../src/config";
import { createLogger } from "../../src/logger";
import { startFakeListmonk, type FakeListmonk } from "../fakes/listmonk";

let lm: FakeListmonk;
const logger = createLogger({ logLevel: "silent", isProd: false });
const make = (over: Partial<ConstructorParameters<typeof ListmonkProvider>[0]> = {}, opts: ConstructorParameters<typeof ListmonkProvider>[3] = {}) =>
  new ListmonkProvider({ url: lm.url, user: "blog", apiToken: "test-token", ...over }, logger, fetch, { backoffMs: 1, ...opts });

beforeAll(async () => {
  lm = await startFakeListmonk({ user: "blog", token: "test-token", scheme: "any" });
});
afterAll(() => lm.close());
beforeEach(() => lm.reset());
afterEach(() => vi.restoreAllMocks());

describe("authentication", () => {
  it("sends `Authorization: token user:token` by default and basic auth when configured", async () => {
    await make({ listId: "1" }).upsertSubscriber("a@example.com");
    expect(lm.requests[0]!.headers.authorization).toBe("token blog:test-token");
    lm.requests.length = 0;
    await make({ listId: "1" }, { authScheme: "basic" }).upsertSubscriber("b@example.com");
    expect(lm.requests[0]!.headers.authorization).toBe(`Basic ${Buffer.from("blog:test-token").toString("base64")}`);
  });

  it("bad credentials → ListmonkError(403), no retries, and the secret never appears in the message", async () => {
    const p = new ListmonkProvider({ url: lm.url, user: "blog", apiToken: "WRONG-SECRET-TOKEN", listId: "1" }, logger, fetch, { backoffMs: 1 });
    const err = await p.upsertSubscriber("a@example.com").catch((e) => e);
    expect(err).toBeInstanceOf(ListmonkError);
    expect(err.status).toBe(403);
    expect(String(err.message)).not.toContain("WRONG-SECRET-TOKEN");
    expect(lm.count("POST /api/subscribers")).toBe(1);
  });
});

describe("lists", () => {
  it("uses LISTMONK_LIST_ID when numeric without touching /api/lists", async () => {
    await make({ listId: "7" }).upsertSubscriber("a@example.com");
    expect(lm.count("GET /api/lists")).toBe(0);
    expect(lm.requests.find((r) => r.method === "POST")!.body.lists).toEqual([7]);
  });

  it("finds or creates the managed list when no id is configured, once", async () => {
    const p = make();
    await p.upsertSubscriber("a@example.com");
    await p.upsertSubscriber("b@example.com");
    expect(lm.lists).toHaveLength(1);
    expect(lm.lists[0]).toMatchObject({ name: "Blog newsletter", type: "private" });
    expect(lm.count("POST /api/lists")).toBe(1);
    // a new provider instance finds the existing list instead of creating another
    await make().upsertSubscriber("c@example.com");
    expect(lm.lists).toHaveLength(1);
  });
});

describe("subscribers", () => {
  it("creates a subscriber confirmed on the list and returns its numeric id as string", async () => {
    const { externalId } = await make({ listId: "1" }).upsertSubscriber("New@Example.com", "New Person");
    expect(externalId).toBe("1");
    const body = lm.requests.find((r) => r.method === "POST")!.body;
    expect(body).toMatchObject({ email: "New@Example.com", name: "New Person", status: "enabled", lists: [1], preconfirm_subscriptions: true });
    expect(lm.subscribers[0]).toMatchObject({ email: "new@example.com", status: "enabled" });
  });

  it("handles 409 (exists): looks up and PUTs, keeping other lists and re-enabling a blocklisted one", async () => {
    lm.subscribers.push({ id: 5, email: "old@example.com", name: "Old Name", status: "blocklisted", attribs: { plan: "x" }, lists: [{ id: 9, name: "other", subscription_status: "confirmed" }] });
    const { externalId } = await make({ listId: "1" }).upsertSubscriber("OLD@example.com", "Ignored Name");
    expect(externalId).toBe("5");
    const put = lm.requests.find((r) => r.method === "PUT")!;
    expect(put.path).toBe("/api/subscribers/5");
    expect(put.body).toMatchObject({ status: "enabled", name: "Old Name", attribs: { plan: "x" }, preconfirm_subscriptions: true });
    expect([...put.body.lists].sort()).toEqual([1, 9]);
    expect(lm.subscribers[0]!.status).toBe("enabled");
  });

  it("escapes quotes in the lookup query", async () => {
    lm.subscribers.push({ id: 1, email: "o'brien@example.com", name: "OB", status: "enabled", attribs: {}, lists: [] });
    const { externalId } = await make({ listId: "1" }).upsertSubscriber("o'brien@example.com");
    expect(externalId).toBe("1");
  });

  it("removeSubscriber blocklists by id or email; unknown is a no-op", async () => {
    const p = make({ listId: "1" });
    await p.upsertSubscriber("a@example.com");
    await p.upsertSubscriber("b@example.com");
    await p.removeSubscriber("1");
    await p.removeSubscriber("B@example.com");
    expect(lm.subscribers.map((s) => s.status)).toEqual(["blocklisted", "blocklisted"]);
    await expect(p.removeSubscriber("nobody@example.com")).resolves.toBeUndefined();
    await expect(p.removeSubscriber("999")).resolves.toBeUndefined();
  });

  it("deleteSubscriber erases by id or email", async () => {
    const p = make({ listId: "1" });
    await p.upsertSubscriber("a@example.com");
    await p.upsertSubscriber("b@example.com");
    await p.deleteSubscriber("1");
    await p.deleteSubscriber("b@example.com");
    expect(lm.subscribers).toHaveLength(0);
    await expect(p.deleteSubscriber("ghost@example.com")).resolves.toBeUndefined();
  });
});

describe("campaigns", () => {
  it("creates an html campaign on the list with a pass-through template, then starts it", async () => {
    const p = make({ listId: "3" });
    const { campaignId } = await p.sendCampaign({ name: "News (2026)", subject: "Hello", html: "<p>Hi {{ UnsubscribeURL }}</p>" });
    expect(campaignId).toBe("1");
    const create = lm.requests.find((r) => r.method === "POST" && r.path === "/api/campaigns")!;
    expect(create.body).toMatchObject({ name: "News (2026)", subject: "Hello", lists: [3], type: "regular", content_type: "html", messenger: "email", body: "<p>Hi {{ UnsubscribeURL }}</p>" });
    expect(lm.templates).toEqual([expect.objectContaining({ name: "blog-raw", type: "campaign", body: '{{ template "content" . }}' })]);
    expect(create.body.template_id).toBe(lm.templates[0]!.id);
    expect(lm.campaigns[0]!.status).toBe("running");
    // template is created once and reused
    await p.sendCampaign({ name: "Two", subject: "S", html: "x" });
    expect(lm.templates).toHaveLength(1);
  });

  it("uses a configured template id and from_email", async () => {
    await make({ listId: "1" }, { templateId: 42, fromEmail: "Blog <blog@example.com>" }).sendCampaign({ name: "n", subject: "s", html: "x" });
    expect(lm.templates).toHaveLength(0);
    expect(lm.campaigns[0]).toMatchObject({ template_id: 42, from_email: "Blog <blog@example.com>" });
  });

  it("a failed start carries the created campaign id; startCampaign finishes it later", async () => {
    const p = make({ listId: "1" }, { retries: 0 });
    lm.failNext("PUT /api/campaigns/1/status", 500, 1);
    const err = await p.sendCampaign({ name: "n", subject: "s", html: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ListmonkError);
    expect(err.campaignId).toBe("1");
    expect(lm.campaigns[0]!.status).toBe("draft");
    await p.startCampaign("1");
    expect(lm.campaigns[0]!.status).toBe("running");
    expect(lm.campaigns).toHaveLength(1);
  });

  it("test send: ensures the recipient exists (no list), then posts to /test with the html", async () => {
    await make({ listId: "1" }).testCampaign({ subject: "[Test] Hi", to: "me@example.com", html: "<p>body</p>" });
    expect(lm.subscribers).toEqual([expect.objectContaining({ email: "me@example.com", lists: [] })]);
    expect(lm.tests).toHaveLength(1);
    expect(lm.tests[0]).toMatchObject({ campaignId: 0, subscribers: ["me@example.com"] });
    expect(lm.tests[0]!.body).toMatchObject({ subject: "[Test] Hi", body: "<p>body</p>", content_type: "html" });
    // an existing subscriber (409) is fine
    await make({ listId: "1" }).testCampaign({ subject: "again", to: "me@example.com", html: "<p>b</p>" });
    expect(lm.tests).toHaveLength(2);
  });

  it("test send of an existing campaign uses its stored body", async () => {
    const p = make({ listId: "1" });
    const { campaignId } = await p.sendCampaign({ name: "n", subject: "orig", html: "<p>stored body</p>" });
    await p.testCampaign({ subject: "[Test] orig", to: "me@example.com", campaignId });
    expect(lm.tests[0]).toMatchObject({ campaignId: Number(campaignId) });
    expect(lm.tests[0]!.body.body).toBe("<p>stored body</p>");
  });

  it("maps campaign stats", async () => {
    const p = make({ listId: "1" });
    const { campaignId } = await p.sendCampaign({ name: "n", subject: "s", html: "x" });
    lm.setCampaignStats(1, { sent: 90, to_send: 100, views: 40, clicks: 12, bounces: 3, status: "finished" });
    expect(await p.campaignStats(campaignId)).toEqual({ sent: 90, toSend: 100, views: 40, clicks: 12, bounces: 3, status: "finished" });
    await expect(p.campaignStats("999")).rejects.toMatchObject({ status: 404 });
  });
});

describe("resilience", () => {
  it("retries idempotent requests on 5xx with backoff, then succeeds", async () => {
    const p = make({ listId: "1" }, { retries: 2 });
    await p.upsertSubscriber("a@example.com");
    lm.failNext("GET /api/campaigns/", 503, 2);
    await p.sendCampaign({ name: "n", subject: "s", html: "x" });
    lm.setCampaignStats(1, { sent: 1 });
    expect((await p.campaignStats("1")).sent).toBe(1);
    expect(lm.count("GET /api/campaigns/1")).toBe(3);
  });

  it("gives up after the configured retries and surfaces an http error", async () => {
    const p = make({ listId: "1" }, { retries: 2 });
    lm.failNext("GET /api/campaigns/", 500, 10);
    const err = await p.campaignStats("1").catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 500 });
    expect(lm.count("GET /api/campaigns/1")).toBe(3);
  });

  it("does not retry a POST that failed with 500 (no duplicate campaigns), but does for 503", async () => {
    const p = make({ listId: "1" }, { retries: 2 });
    lm.failNext("POST /api/campaigns", 500, 1);
    await expect(p.sendCampaign({ name: "n", subject: "s", html: "x" })).rejects.toMatchObject({ status: 500 });
    expect(lm.count("POST /api/campaigns")).toBe(1);
    expect(lm.campaigns).toHaveLength(0);
    lm.failNext("POST /api/campaigns", 503, 1);
    await p.sendCampaign({ name: "n", subject: "s", html: "x" });
    expect(lm.campaigns).toHaveLength(1);
  });

  it("does not retry 4xx", async () => {
    const p = make({ listId: "1" });
    await expect(p.campaignStats("404")).rejects.toMatchObject({ status: 404 });
    expect(lm.count("GET /api/campaigns/404")).toBe(1);
  });

  it("network failures are retried and reported as kind=network; timeouts as kind=timeout", async () => {
    const dead = new ListmonkProvider({ url: "http://127.0.0.1:1", user: "u", apiToken: "t", listId: "1" }, logger, fetch, { backoffMs: 1, retries: 1 });
    await expect(dead.campaignStats("1")).rejects.toMatchObject({ kind: "network" });
    const slow = new ListmonkProvider({ url: lm.url, user: "blog", apiToken: "test-token", listId: "1" }, logger, ((_u: unknown, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as unknown as typeof fetch, { backoffMs: 1, retries: 0, timeoutMs: 20 });
    await expect(slow.campaignStats("1")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("a dropped connection on GET is retried", async () => {
    const p = make({ listId: "1" }, { retries: 2 });
    await p.sendCampaign({ name: "n", subject: "s", html: "x" });
    lm.failNext("GET /api/campaigns/1", 0, 1, { drop: true });
    expect((await p.campaignStats("1")).status).toBe("running");
  });

  it("an unexpected body is a protocol error", async () => {
    const odd = new ListmonkProvider({ url: lm.url, user: "blog", apiToken: "test-token", listId: "1" }, logger, (async () => new Response("<html>proxy error</html>", { status: 200 })) as unknown as typeof fetch, { retries: 0 });
    await expect(odd.campaignStats("1")).rejects.toMatchObject({ kind: "protocol" });
  });
});

describe("createNewsletterProvider", () => {
  it("noop without LISTMONK_URL; listmonk with url + credentials", () => {
    expect(createNewsletterProvider(loadConfig({ NODE_ENV: "test" }), logger)).toBeInstanceOf(NoopProvider);
    const p = createNewsletterProvider(loadConfig({ NODE_ENV: "test", LISTMONK_URL: "http://lm:9000", LISTMONK_USER: "u", LISTMONK_API_TOKEN: "t" }), logger);
    expect(p).toBeInstanceOf(ListmonkProvider);
    expect(p.kind).toBe("listmonk");
  });
});
