import { eq, subscriber } from "@blog/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { anonAgent, buildTestApp, findLink, signUpAndSignIn, type TestApp } from "../helpers";
import type { CampaignStats, NewsletterProvider, TestCampaignInput } from "../../src/services/newsletter";
import { BASE } from "./fixtures";

class FakeProvider implements NewsletterProvider {
  readonly kind = "fake";
  upserts: Array<{ email: string; name?: string }> = [];
  removed: string[] = [];
  nextId = 100;
  failUpsert = false;
  failRemove = false;
  externalId: string | null = null; // force a specific id (e.g. "noop")
  async upsertSubscriber(email: string, name?: string) {
    if (this.failUpsert) throw new Error("listmonk down");
    this.upserts.push({ email, name });
    return { externalId: this.externalId ?? String(this.nextId++) };
  }
  async removeSubscriber(idOrEmail: string) {
    if (this.failRemove) throw new Error("listmonk down");
    this.removed.push(idOrEmail);
  }
  async sendCampaign(): Promise<{ campaignId: string }> {
    return { campaignId: "1" };
  }
  async testCampaign(_i: TestCampaignInput): Promise<void> {}
  async campaignStats(): Promise<CampaignStats> {
    return { sent: 0, toSend: 0, views: 0, clicks: 0, bounces: 0 };
  }
}

let t: TestApp;
let now = BASE;
const provider = new FakeProvider();
beforeAll(async () => {
  t = await buildTestApp({
    env: { LISTMONK_WEBHOOK_SECRET: "hook-secret" },
    deps: { now: () => now, newsletter: provider },
  });
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  now = BASE;
  Object.assign(provider, { upserts: [], removed: [], nextId: 100, failUpsert: false, failRemove: false, externalId: null });
});

const api = (path: string) => `/api${path}`;
const subscribe = (email: string, extra: object = {}) => anonAgent(t).post(api("/newsletter/subscribe")).send({ email, ...extra });
const rowOf = async (email: string) => (await t.db.select().from(subscriber).where(eq(subscriber.email, email.toLowerCase())))[0];
const confirmTokenFromMail = (email: string): string => {
  const mail = t.mailer.last(email)!;
  const link = findLink(mail, /newsletter\/confirm/)!;
  return new URL(link).searchParams.get("token")!;
};
const minutes = (n: number) => new Date(BASE.getTime() + n * 60_000);

describe("subscribe", () => {
  it("creates a pending subscriber (lowercased) and mails a confirmation link", async () => {
    const res = await subscribe("  New.Person@Example.COM ", { source: "footer" }).expect(202);
    expect(res.body.data).toEqual({ status: "pending" });
    const row = await rowOf("new.person@example.com");
    expect(row).toMatchObject({ status: "pending", source: "footer", userId: null, listmonkSubscriberId: null });
    expect(row!.unsubscribeToken.length).toBeGreaterThanOrEqual(43);
    const mail = t.mailer.last("new.person@example.com")!;
    expect(mail.to).toBe("new.person@example.com");
    expect(mail.subject).toMatch(/confirm/i);
    const link = findLink(mail, /newsletter\/confirm/)!;
    expect(link.startsWith("http://localhost:3000/newsletter/confirm?token=")).toBe(true);
    expect(confirmTokenFromMail("new.person@example.com")).toBe(row!.confirmToken);
    expect(row!.confirmToken!.length).toBeGreaterThanOrEqual(43);
    expect(mail.html).toContain("newsletter/confirm?token=");
    expect(findLink(mail, /newsletter\/unsubscribe/)).toContain(row!.unsubscribeToken);
    expect(provider.upserts).toEqual([]); // nothing is pushed before confirmation
  });

  it("validates input", async () => {
    await subscribe("not-an-email").expect(400);
    await anonAgent(t).post(api("/newsletter/subscribe")).send({}).expect(400);
    await subscribe("a@b.co", { source: "x".repeat(65) }).expect(400);
  });

  it("does not resend within 5 minutes, then sends a fresh token that replaces the old one", async () => {
    await subscribe("a@example.com").expect(202);
    const t1 = confirmTokenFromMail("a@example.com");
    now = minutes(4);
    await subscribe("a@example.com").expect(202);
    expect(t.mailer.to("a@example.com")).toHaveLength(1);
    now = minutes(6);
    await subscribe("a@example.com").expect(202);
    expect(t.mailer.to("a@example.com")).toHaveLength(2);
    const t2 = confirmTokenFromMail("a@example.com");
    expect(t2).not.toBe(t1);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: t1 }).expect(400);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: t2 }).expect(200);
  });

  it("is silent for already confirmed addresses and identical for known/unknown ones (no enumeration)", async () => {
    const fresh = await subscribe("fresh@example.com").expect(202);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail("fresh@example.com") }).expect(200);
    t.mailer.clear();
    const again = await subscribe("fresh@example.com").expect(202);
    expect(t.mailer.outbox).toHaveLength(0);
    expect(again.body).toEqual(fresh.body);
    expect((await rowOf("fresh@example.com"))!.status).toBe("confirmed");
  });

  it("still answers 202 when the mail transport fails", async () => {
    t.mailer.failWith = new Error("smtp down");
    try {
      await subscribe("x@example.com").expect(202);
    } finally {
      t.mailer.failWith = null;
    }
  });

  it("re-subscribing after unsubscribing starts a new double opt-in", async () => {
    await subscribe("back@example.com").expect(202);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail("back@example.com") }).expect(200);
    await anonAgent(t).post(api("/newsletter/unsubscribe")).send({ token: (await rowOf("back@example.com"))!.unsubscribeToken }).expect(200);
    t.mailer.clear();
    await subscribe("back@example.com").expect(202);
    expect(t.mailer.outbox).toHaveLength(1);
    expect((await rowOf("back@example.com"))!.status).toBe("pending");
  });
});

describe("confirm", () => {
  it("confirms, pushes to the provider and stores the numeric listmonk id", async () => {
    await subscribe("c@example.com").expect(202);
    const res = await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail("c@example.com") }).expect(200);
    expect(res.body).toEqual({ data: { status: "confirmed" } });
    const row = (await rowOf("c@example.com"))!;
    expect(row).toMatchObject({ status: "confirmed", listmonkSubscriberId: 100 });
    expect(row.confirmedAt).toBeInstanceOf(Date);
    expect(provider.upserts).toEqual([{ email: "c@example.com", name: undefined }]);
  });

  it("is idempotent (second click: still confirmed, provider not hit again)", async () => {
    await subscribe("c@example.com").expect(202);
    const token = confirmTokenFromMail("c@example.com");
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token }).expect(200);
    const second = await anonAgent(t).post(api("/newsletter/confirm")).send({ token }).expect(200);
    expect(second.body.data.status).toBe("confirmed");
    expect(provider.upserts).toHaveLength(1);
  });

  it("rejects unknown, malformed and expired (> 7 days) tokens", async () => {
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: "x".repeat(40) }).expect(400);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: "short" }).expect(400);
    await anonAgent(t).post(api("/newsletter/confirm")).send({}).expect(400);
    await subscribe("late@example.com").expect(202);
    const token = confirmTokenFromMail("late@example.com");
    now = new Date(BASE.getTime() + 7 * 86_400_000 + 60_000);
    const res = await anonAgent(t).post(api("/newsletter/confirm")).send({ token }).expect(400);
    expect(res.body.error.code).toBe("validation_error");
    expect((await rowOf("late@example.com"))!.status).toBe("pending");
    now = new Date(BASE.getTime() + 6 * 86_400_000);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token }).expect(200);
  });

  it("still confirms when the provider is down (best effort) and ignores non-numeric provider ids", async () => {
    provider.failUpsert = true;
    await subscribe("d@example.com").expect(202);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail("d@example.com") }).expect(200);
    expect(await rowOf("d@example.com")).toMatchObject({ status: "confirmed", listmonkSubscriberId: null });
    provider.failUpsert = false;
    provider.externalId = "noop";
    await subscribe("e@example.com").expect(202);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail("e@example.com") }).expect(200);
    expect(await rowOf("e@example.com")).toMatchObject({ status: "confirmed", listmonkSubscriberId: null });
  });

  it("links the subscriber to an existing verified account with the same email", async () => {
    const { user } = await signUpAndSignIn(t);
    await subscribe(user.email).expect(202);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail(user.email) }).expect(200);
    expect(await rowOf(user.email)).toMatchObject({ status: "confirmed", userId: user.id });
  });

  it("an old confirm link cannot resurrect an unsubscribed address", async () => {
    await subscribe("f@example.com").expect(202);
    const token = confirmTokenFromMail("f@example.com");
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token }).expect(200);
    await anonAgent(t).post(api("/newsletter/unsubscribe")).send({ token: (await rowOf("f@example.com"))!.unsubscribeToken }).expect(200);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token }).expect(400);
    expect((await rowOf("f@example.com"))!.status).toBe("unsubscribed");
  });
});

describe("unsubscribe", () => {
  async function confirmed(email: string) {
    await subscribe(email).expect(202);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail(email) }).expect(200);
    return (await rowOf(email))!;
  }

  it("POST unsubscribes, removes from the provider by id, and is idempotent", async () => {
    const row = await confirmed("u@example.com");
    const res = await anonAgent(t).post(api("/newsletter/unsubscribe")).send({ token: row.unsubscribeToken }).expect(200);
    expect(res.body).toEqual({ data: { status: "unsubscribed" } });
    expect(await rowOf("u@example.com")).toMatchObject({ status: "unsubscribed" });
    expect((await rowOf("u@example.com"))!.unsubscribedAt).toBeInstanceOf(Date);
    expect(provider.removed).toEqual(["100"]);
    await anonAgent(t).post(api("/newsletter/unsubscribe")).send({ token: row.unsubscribeToken }).expect(200);
    expect(provider.removed).toEqual(["100"]);
  });

  it("falls back to the email when there is no provider id; provider failures do not matter", async () => {
    await subscribe("p@example.com").expect(202);
    const row = (await rowOf("p@example.com"))!;
    provider.failRemove = true;
    await anonAgent(t).post(api("/newsletter/unsubscribe")).send({ token: row.unsubscribeToken }).expect(200);
    expect((await rowOf("p@example.com"))!.status).toBe("unsubscribed");
  });

  it("answers 404 for unknown tokens and 400 for missing ones", async () => {
    await anonAgent(t).post(api("/newsletter/unsubscribe")).send({ token: "n".repeat(43) }).expect(404);
    await anonAgent(t).post(api("/newsletter/unsubscribe")).send({}).expect(400);
  });

  it("supports RFC 8058 one-click POSTs (token in the query string, form-encoded body)", async () => {
    const row = await confirmed("oc@example.com");
    await request(t.app)
      .post(`/api/newsletter/unsubscribe?token=${encodeURIComponent(row.unsubscribeToken)}`)
      .type("form")
      .send("List-Unsubscribe=One-Click")
      .expect(200);
    expect((await rowOf("oc@example.com"))!.status).toBe("unsubscribed");
  });

  it("GET shows a small HTML confirmation page (and 404/400 pages for bad links)", async () => {
    const row = await confirmed("g@example.com");
    const res = await request(t.app).get(`/api/newsletter/unsubscribe?token=${encodeURIComponent(row.unsubscribeToken)}`).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("You are unsubscribed");
    expect((await rowOf("g@example.com"))!.status).toBe("unsubscribed");
    const bad = await request(t.app).get(`/api/newsletter/unsubscribe?token=${"z".repeat(43)}`).expect(404);
    expect(bad.headers["content-type"]).toMatch(/text\/html/);
    await request(t.app).get("/api/newsletter/unsubscribe").expect(400).expect("content-type", /html/);
  });
});

describe("rate limiting", () => {
  it("subscribe is limited to 5/min/IP", async () => {
    const limited = await buildTestApp({ env: { RATE_LIMIT_ENABLED: "1" } });
    try {
      for (let i = 0; i < 5; i++) await request(limited.app).post("/api/newsletter/subscribe").send({ email: `r${i}@example.com` }).expect(202);
      const res = await request(limited.app).post("/api/newsletter/subscribe").send({ email: "r9@example.com" }).expect(429);
      expect(res.body.error.code).toBe("rate_limited");
    } finally {
      await limited.close();
    }
  });
});

describe("/me/subscription", () => {
  it("requires sign-in", async () => {
    await anonAgent(t).get(api("/me/subscription")).expect(401);
    await anonAgent(t).put(api("/me/subscription")).send({ subscribed: true }).expect(401);
    await anonAgent(t).delete(api("/me/subscription")).expect(401);
  });

  it("GET null → PUT true confirms instantly and links the user → PUT false → DELETE", async () => {
    const { agent, user } = await signUpAndSignIn(t, { name: "Sub Scriber" });
    expect((await agent.get(api("/me/subscription")).expect(200)).body).toEqual({ data: null });
    expect((await agent.get(api("/me")).expect(200)).body.data.subscription).toBeNull();

    const put = await agent.put(api("/me/subscription")).send({ subscribed: true }).expect(200);
    expect(put.body).toEqual({ data: { status: "confirmed" } });
    const row = (await rowOf(user.email))!;
    expect(row).toMatchObject({ status: "confirmed", userId: user.id, listmonkSubscriberId: 100, source: "account" });
    expect(provider.upserts).toEqual([{ email: user.email, name: "Sub Scriber" }]);
    expect(t.mailer.outbox).toHaveLength(0); // no double opt-in mail for verified users
    expect((await agent.get(api("/me"))).body.data.subscription).toEqual({ status: "confirmed" });
    await agent.put(api("/me/subscription")).send({ subscribed: true }).expect(200); // idempotent
    expect(provider.upserts).toHaveLength(1);

    const off = await agent.put(api("/me/subscription")).send({ subscribed: false }).expect(200);
    expect(off.body).toEqual({ data: { status: "unsubscribed" } });
    expect(provider.removed).toEqual(["100"]);
    expect((await agent.get(api("/me/subscription"))).body).toEqual({ data: { status: "unsubscribed" } });

    await agent.put(api("/me/subscription")).send({ subscribed: true }).expect(200);
    expect((await rowOf(user.email))!.status).toBe("confirmed");

    await agent.delete(api("/me/subscription")).expect(204);
    expect(await rowOf(user.email)).toBeUndefined();
    expect((await agent.get(api("/me/subscription"))).body).toEqual({ data: null });
    await agent.delete(api("/me/subscription")).expect(204); // idempotent
  });

  it("adopts an earlier anonymous subscription of the same address", async () => {
    const { agent, user } = await signUpAndSignIn(t);
    await subscribe(user.email).expect(202);
    expect((await agent.get(api("/me/subscription"))).body.data).toEqual({ status: "pending" });
    await agent.put(api("/me/subscription")).send({ subscribed: true }).expect(200);
    expect(await rowOf(user.email)).toMatchObject({ status: "confirmed", userId: user.id });
  });

  it("validates the body", async () => {
    const { agent } = await signUpAndSignIn(t);
    await agent.put(api("/me/subscription")).send({ subscribed: "yes" }).expect(400);
    await agent.put(api("/me/subscription")).send({}).expect(400);
  });

  it("subscribing requires a verified email", async () => {
    const lax = await buildTestApp({ env: { REQUIRE_EMAIL_VERIFICATION: "false" } });
    try {
      const { agent } = await signUpAndSignIn(lax, { verified: false });
      await agent.put("/api/me/subscription").send({ subscribed: true }).expect(403);
    } finally {
      await lax.close();
    }
  });

  it("account deletion also removes the subscription (A3 behaviour stays intact)", async () => {
    const { agent, user } = await signUpAndSignIn(t);
    await agent.put(api("/me/subscription")).send({ subscribed: true }).expect(200);
    await agent.delete(api("/me")).expect(204);
    expect(await rowOf(user.email)).toBeUndefined();
    expect(provider.removed).toContain("100");
  });
});

describe("POST /webhooks/listmonk", () => {
  const hook = (secret: string | undefined, body: unknown) => {
    const r = request(t.app).post(api("/webhooks/listmonk"));
    if (secret !== undefined) r.set("x-webhook-secret", secret);
    return r.send(body as object);
  };
  async function confirmed(email: string) {
    await subscribe(email).expect(202);
    await anonAgent(t).post(api("/newsletter/confirm")).send({ token: confirmTokenFromMail(email) }).expect(200);
  }

  it("rejects a missing or wrong secret with 401", async () => {
    await confirmed("w@example.com");
    await hook(undefined, { event: "unsubscribe", email: "w@example.com" }).expect(401);
    await hook("nope", { event: "unsubscribe", email: "w@example.com" }).expect(401);
    await hook("hook-secre", { event: "unsubscribe", email: "w@example.com" }).expect(401);
    expect((await rowOf("w@example.com"))!.status).toBe("confirmed");
  });

  it("is disabled (401) when no secret is configured", async () => {
    const nohook = await buildTestApp();
    try {
      await request(nohook.app).post("/api/webhooks/listmonk").set("x-webhook-secret", "").send({ event: "unsubscribe", email: "a@b.co" }).expect(401);
      await request(nohook.app).post("/api/webhooks/listmonk").set("x-webhook-secret", "anything").send({}).expect(401);
    } finally {
      await nohook.close();
    }
  });

  it("marks subscribers unsubscribed on unsubscribe/blocklist/bounce events (by email or listmonk id)", async () => {
    await confirmed("w1@example.com");
    await confirmed("w2@example.com");
    await confirmed("w3@example.com");
    expect((await hook("hook-secret", { event: "subscriber.unsubscribed", subscriber: { email: "W1@example.com", id: 100 } }).expect(200)).body.data).toEqual({ handled: true, updated: 1 });
    expect((await rowOf("w1@example.com"))!.status).toBe("unsubscribed");
    await hook("hook-secret", { type: "bounce", subscriber_id: 101 }).expect(200);
    expect((await rowOf("w2@example.com"))!.status).toBe("unsubscribed");
    await hook("hook-secret", { data: { email: "w3@example.com" }, event: "subscriber.blocklisted" }).expect(200);
    expect((await rowOf("w3@example.com"))!.status).toBe("unsubscribed");
  });

  it("acknowledges unknown events and junk without changing anything", async () => {
    await confirmed("keep@example.com");
    expect((await hook("hook-secret", { event: "campaign.started", email: "keep@example.com" }).expect(200)).body.data).toEqual({ handled: false, updated: 0 });
    await hook("hook-secret", "just a string").expect(200);
    await hook("hook-secret", { event: "unsubscribe" }).expect(200); // nothing to match on
    await hook("hook-secret", { event: "unsubscribe", email: "stranger@example.com" }).expect(200);
    expect((await rowOf("keep@example.com"))!.status).toBe("confirmed");
  });
});
