import { eq, session, user } from "@blog/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findLink } from "../src/services/mailer";
import { TEST_PASSWORD, anonAgent, buildTestApp, createUser, signIn, signUpAndSignIn, signUpViaApiAndVerify, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ env: { ADMIN_EMAILS: "boss@example.com" } });
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const AUTH = "/api/auth";

describe("email + password auth", () => {
  it("sign-up → verification mail → verify link → signed in → /api/me", async () => {
    const email = "newbie@example.com";
    const agent = anonAgent(t);

    const signUp = await agent.post(`${AUTH}/sign-up/email`).send({ email, password: TEST_PASSWORD, name: "Newbie" });
    expect(signUp.status).toBe(200);
    // unverified accounts get no session (REQUIRE_EMAIL_VERIFICATION)
    await agent.get("/api/me").expect(401);
    await agent.post(`${AUTH}/sign-in/email`).send({ email, password: TEST_PASSWORD }).expect(403);

    const mails = t.mailer.to(email);
    expect(mails.length).toBeGreaterThanOrEqual(1);
    const mail = mails[mails.length - 1]!;
    expect(mail.subject).toMatch(/confirm/i);
    expect(mail.html).toContain("<a ");
    const link = findLink(mail, /verify-email/);
    expect(link).toBeTruthy();
    const u = new URL(link!);
    expect(u.origin).toBe("http://localhost:3000"); // public origin, not the API's
    await agent.get(`${u.pathname}${u.search}`).expect((r) => expect(r.status).toBeLessThan(400));

    const me = await agent.get("/api/me").expect(200);
    expect(me.body.data).toMatchObject({ email, name: "Newbie", role: "reader", emailVerified: true, subscription: null });

    // and a fresh sign-in works too
    const again = await signIn(t, { email, password: TEST_PASSWORD });
    await again.get("/api/me").expect(200);
  });

  it("signUpViaApiAndVerify helper yields a signed-in agent", async () => {
    const { agent, email } = await signUpViaApiAndVerify(t);
    const me = await agent.get("/api/me").expect(200);
    expect(me.body.data.email).toBe(email);
  });

  it("rejects wrong passwords and short passwords", async () => {
    const u = await createUser(t);
    const agent = anonAgent(t);
    await agent.post(`${AUTH}/sign-in/email`).send({ email: u.email, password: "wrong-password-123" }).expect(401);
    const short = await agent.post(`${AUTH}/sign-up/email`).send({ email: "x@example.com", password: "short", name: "X" });
    expect(short.status).toBe(400);
  });

  it("cannot self-assign a role at sign-up", async () => {
    const agent = anonAgent(t);
    await agent.post(`${AUTH}/sign-up/email`).send({ email: "sneaky@example.com", password: TEST_PASSWORD, name: "S", role: "admin" });
    const [row] = await t.db.select().from(user).where(eq(user.email, "sneaky@example.com"));
    expect(row?.role ?? "reader").toBe("reader");
  });

  it("ADMIN_EMAILS promotes an account only after its email is verified", async () => {
    const { agent, email } = await (async () => {
      const email = "boss@example.com";
      const agent = anonAgent(t);
      await agent.post(`${AUTH}/sign-up/email`).send({ email, password: TEST_PASSWORD, name: "Boss" }).expect(200);
      const [before] = await t.db.select().from(user).where(eq(user.email, email));
      expect(before!.role).toBe("reader"); // unverified: not promoted
      const u = new URL(findLink(t.mailer.last(email)!, /verify-email/)!);
      await agent.get(`${u.pathname}${u.search}`);
      return { agent, email };
    })();
    const [after] = await t.db.select().from(user).where(eq(user.email, email));
    expect(after!.role).toBe("admin");
    const me = await agent.get("/api/me").expect(200);
    expect(me.body.data.role).toBe("admin");
  });

  it("password reset sends a mail and the new password works", async () => {
    const u = await createUser(t);
    const agent = anonAgent(t);
    await agent.post(`${AUTH}/request-password-reset`).send({ email: u.email, redirectTo: "http://localhost:3000/reset-password" }).expect(200);
    const mail = t.mailer.last(u.email)!;
    expect(mail.subject).toMatch(/reset/i);
    const link = findLink(mail, /reset-password/)!;
    const token = new URL(link).pathname.split("/").pop()!;
    await agent.post(`${AUTH}/reset-password`).send({ newPassword: "a-brand-new-password-1", token }).expect(200);
    await signIn(t, { email: u.email, password: "a-brand-new-password-1" });
    await anonAgent(t).post(`${AUTH}/sign-in/email`).send({ email: u.email, password: u.password }).expect(401);
  });

  it("sign-out invalidates the session", async () => {
    const s = await signUpAndSignIn(t);
    await s.agent.get("/api/me").expect(200);
    await s.agent.post(`${AUTH}/sign-out`).send({}).expect(200);
    await s.agent.get("/api/me").expect(401);
  });
});

describe("banned users", () => {
  it("cannot sign in", async () => {
    const u = await createUser(t, { banned: true });
    const res = await anonAgent(t).post(`${AUTH}/sign-in/email`).send({ email: u.email, password: u.password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("USER_BANNED");
  });

  it("an existing session stops working as soon as the user is banned", async () => {
    const s = await signUpAndSignIn(t);
    await s.agent.get("/api/me").expect(200);
    await t.db.update(user).set({ banned: true, banReason: "spam" }).where(eq(user.id, s.user.id));
    const res = await s.agent.get("/api/me").expect(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("session rows can be revoked", async () => {
    const s = await signUpAndSignIn(t);
    expect(await t.db.select().from(session).where(eq(session.userId, s.user.id))).toHaveLength(1);
    const { revokeUserSessions } = await import("../src/auth");
    await revokeUserSessions(t.db, s.user.id);
    await s.agent.get("/api/me").expect(401);
  });
});
