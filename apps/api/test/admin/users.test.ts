import { auditLog, eq, post, session, user } from "@blog/db";
import { AdminUserSchema } from "@blog/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, createUser, signIn, type TestApp } from "../helpers";
import { API, adminSession, auditActions, getUser, insertComment, insertPost, insertPost as _p, type Admin } from "./helpers";

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
void _p;

describe("list / get", () => {
  it("searches, filters by role/banned and paginates", async () => {
    await createUser(t, { name: "Alice Anderson", email: "alice@example.com" });
    await createUser(t, { name: "Bob", email: "bob@example.com", banned: true });
    await createUser(t, { name: "Carol", email: "carol@corp.test", role: "admin" });
    const all = await admin.agent.get(`${API}/users`).expect(200);
    expect(all.body.meta.total).toBe(4);
    for (const u of all.body.data) AdminUserSchema.parse(u);
    expect((await admin.agent.get(`${API}/users?q=ALICE`)).body.data.map((u: any) => u.email)).toEqual(["alice@example.com"]);
    expect((await admin.agent.get(`${API}/users?q=corp.test`)).body.data).toHaveLength(1);
    expect((await admin.agent.get(`${API}/users?role=admin`)).body.meta.total).toBe(2);
    expect((await admin.agent.get(`${API}/users?banned=true`)).body.data.map((u: any) => u.name)).toEqual(["Bob"]);
    expect((await admin.agent.get(`${API}/users?q=%25`)).body.data).toEqual([]);
    const p2 = await admin.agent.get(`${API}/users?pageSize=3&page=2`).expect(200);
    expect(p2.body.data).toHaveLength(1);
    await admin.agent.get(`${API}/users?role=root`).expect(400);
  });

  it("get by id, 404 otherwise; never exposes password hashes", async () => {
    const u = await createUser(t, {});
    const res = await admin.agent.get(`${API}/users/${u.id}`).expect(200);
    expect(res.body.data.id).toBe(u.id);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    await admin.agent.get(`${API}/users/nope`).expect(404);
  });
});

describe("role changes", () => {
  it("promotes and demotes other users, with audit", async () => {
    const u = await createUser(t, {});
    const up = await admin.agent.patch(`${API}/users/${u.id}`).send({ role: "admin" }).expect(200);
    expect(up.body.data.role).toBe("admin");
    const down = await admin.agent.patch(`${API}/users/${u.id}`).send({ role: "reader" }).expect(200);
    expect(down.body.data.role).toBe("reader");
    expect(await auditActions(t)).toEqual(["user.role", "user.role"]);
    await admin.agent.patch(`${API}/users/${u.id}`).send({ role: "root" }).expect(400);
  });

  it("cannot change your own role", async () => {
    const res = await admin.agent.patch(`${API}/users/${admin.user.id}`).send({ role: "reader" }).expect(403);
    expect(res.body.error.code).toBe("forbidden");
    expect((await getUser(t, admin.user.id))!.role).toBe("admin");
  });

  it("two admins cannot demote each other concurrently into an admin-less system", async () => {
    const other = await createUser(t, { role: "admin" });
    const otherAgent = await signIn(t, other);
    const results = await Promise.all([
      admin.agent.patch(`${API}/users/${other.id}`).send({ role: "reader" }),
      otherAgent.patch(`${API}/users/${admin.user.id}`).send({ role: "reader" }),
    ]);
    const admins = await t.db.select().from(user).where(eq(user.role, "admin"));
    expect(admins.length).toBeGreaterThanOrEqual(1);
    expect(results.map((r) => r.status).sort()).not.toEqual([200, 200]);
  });
});

describe("ban / unban", () => {
  it("bans with reason, revokes sessions and locks the user out; unban restores", async () => {
    const victim = await createUser(t, {});
    const agent = await signIn(t, victim);
    await agent.get("/api/me").expect(200);
    const res = await admin.agent.post(`${API}/users/${victim.id}/ban`).send({ reason: "spam" }).expect(200);
    expect(res.body.data).toMatchObject({ banned: true, banReason: "spam" });
    expect(await t.db.select().from(session).where(eq(session.userId, victim.id))).toHaveLength(0);
    await agent.get("/api/me").expect(401);
    await signIn(t, victim).then(
      () => { throw new Error("banned user signed in"); },
      (e) => expect(String(e)).toMatch(/403/),
    );
    const un = await admin.agent.post(`${API}/users/${victim.id}/unban`).expect(200);
    expect(un.body.data).toMatchObject({ banned: false, banReason: null });
    await signIn(t, victim);
    expect(await auditActions(t)).toEqual(["user.ban", "user.unban"]);
  });

  it("requires a reason; cannot ban yourself; unknown user 404", async () => {
    const u = await createUser(t, {});
    await admin.agent.post(`${API}/users/${u.id}/ban`).send({}).expect(400);
    await admin.agent.post(`${API}/users/${u.id}/ban`).send({ reason: "  " }).expect(400);
    await admin.agent.post(`${API}/users/${admin.user.id}/ban`).send({ reason: "x" }).expect(403);
    await admin.agent.post(`${API}/users/ghost/ban`).send({ reason: "x" }).expect(404);
    await admin.agent.post(`${API}/users/ghost/unban`).expect(404);
  });

  it("another admin can be banned only while a different active admin remains (the actor)", async () => {
    const other = await createUser(t, { role: "admin" });
    await admin.agent.post(`${API}/users/${other.id}/ban`).send({ reason: "rogue" }).expect(200);
  });
});

describe("delete", () => {
  it("deletes a user; comments are anonymised (author null, body kept); sessions cascade", async () => {
    const victim = await createUser(t, {});
    await signIn(t, victim);
    const p = await insertPost(t, admin.user.id, { status: "published", publishedAt: new Date() });
    const c = await insertComment(t, p.id, victim.id, { body: "I was here" });
    await admin.agent.delete(`${API}/users/${victim.id}`).expect(204);
    expect(await getUser(t, victim.id)).toBeUndefined();
    const { comment } = await import("@blog/db");
    const [row] = await t.db.select().from(comment).where(eq(comment.id, c.id));
    expect(row).toMatchObject({ authorId: null, body: "I was here" });
    expect(await t.db.select().from(session).where(eq(session.userId, victim.id))).toHaveLength(0);
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "user.delete"));
    expect(entry!.targetId).toBe(victim.id);
    await admin.agent.delete(`${API}/users/${victim.id}`).expect(404);
  });

  it("cannot delete yourself", async () => {
    await admin.agent.delete(`${API}/users/${admin.user.id}`).expect(403);
  });

  it("409 while the user owns posts; ?reassignTo moves them to another admin", async () => {
    const author = await createUser(t, { role: "admin" });
    const p = await insertPost(t, author.id);
    const res = await admin.agent.delete(`${API}/users/${author.id}`).expect(409);
    expect(res.body.error.details).toEqual({ posts: 1 });
    expect(await getUser(t, author.id)).toBeTruthy();
    // invalid targets
    await admin.agent.delete(`${API}/users/${author.id}?reassignTo=${author.id}`).expect(400);
    const reader = await createUser(t, {});
    await admin.agent.delete(`${API}/users/${author.id}?reassignTo=${reader.id}`).expect(400);
    await admin.agent.delete(`${API}/users/${author.id}?reassignTo=ghost`).expect(400);
    await admin.agent.delete(`${API}/users/${author.id}?reassignTo=${admin.user.id}`).expect(204);
    const [moved] = await t.db.select().from(post).where(eq(post.id, p.id));
    expect(moved!.authorId).toBe(admin.user.id);
    expect(await getUser(t, author.id)).toBeUndefined();
  });

  it("a reader without posts is simply deleted", async () => {
    const reader = await createUser(t, {});
    await admin.agent.delete(`${API}/users/${reader.id}`).expect(204);
  });
});
