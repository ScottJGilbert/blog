import { auditLog, comment, commentReport, eq } from "@blog/db";
import { CommentSchema } from "@blog/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anonAgent, buildTestApp, createUser, signIn, signUpAndSignIn, type TestApp, type TestSession } from "../helpers";
import { BASE, ensureAuthor, insertPost } from "./fixtures";

let t: TestApp;
let now = BASE;
let alice: TestSession;
let bob: TestSession;
let admin: TestSession;
beforeAll(async () => {
  t = await buildTestApp({ env: { REQUIRE_EMAIL_VERIFICATION: "false" }, deps: { now: () => now } });
  await ensureAuthor(t);
  await insertPost(t, { slug: "hello" });
  await insertPost(t, { slug: "other" });
  alice = await signUpAndSignIn(t, { name: "Alice" });
  bob = await signUpAndSignIn(t, { name: "Bob" });
  admin = await signUpAndSignIn(t, { name: "Root", role: "admin" });
});
afterAll(() => t.close());

beforeEach(async () => {
  // keep users, sessions and posts (sign-in is slow); only reset what the tests mutate
  await t.db.delete(commentReport);
  await t.db.delete(comment);
  await t.db.delete(auditLog);
  now = BASE;
});

const post = (s: TestSession, slug: string, body: unknown) => s.agent.post(`/api/posts/${slug}/comments`).send(body as object);
const list = (s: { agent: ReturnType<typeof anonAgent> }, slug = "hello", q = "") => s.agent.get(`/api/posts/${slug}/comments${q}`);
const mins = (n: number) => new Date(BASE.getTime() + n * 60_000);

describe("creating comments", () => {
  it("requires sign-in (401) and a verified email (403)", async () => {
    await anonAgent(t).post("/api/posts/hello/comments").send({ body: "hi" }).expect(401);
    const unverified = await signUpAndSignIn(t, { verified: false });
    const res = await post(unverified, "hello", { body: "hi" }).expect(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("creates a comment (201, Comment shape) and trims/sanitises the body", async () => {
    const res = await post(alice, "hello", { body: "  Hello\u0000 there\r\n\r\n\r\n\r\nline‮  " }).expect(201);
    expect(() => CommentSchema.parse(res.body.data)).not.toThrow();
    expect(res.body.data).toMatchObject({ body: "Hello there\n\nline", status: "visible", parentId: null, replies: [], canEdit: true, canDelete: true, editedAt: null, author: { name: "Alice", image: null } });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("does not linkify or interpret HTML: the body is stored and returned as plain text", async () => {
    const body = `<a href="https://x.test">x</a> https://x.test <script>alert(1)</script>`;
    const res = await post(alice, "hello", { body }).expect(201);
    expect(res.body.data.body).toBe(body);
  });

  it("rejects empty, whitespace-only, over-long and malformed input", async () => {
    await post(alice, "hello", { body: "" }).expect(400);
    await post(alice, "hello", { body: "   \n  " }).expect(400);
    await post(alice, "hello", { body: "\u0001\u0002" }).expect(400);
    await post(alice, "hello", { body: "x".repeat(4001) }).expect(400);
    await post(alice, "hello", {}).expect(400);
    await post(alice, "hello", { body: "ok", parentId: "not-a-uuid" }).expect(400);
    await post(alice, "hello", { body: "x".repeat(4000) }).expect(201);
  });

  it("404 for unknown, draft or future posts", async () => {
    await insertPost(t, { slug: "wip", status: "draft" });
    await post(alice, "nope", { body: "hi" }).expect(404);
    await post(alice, "wip", { body: "hi" }).expect(404);
    await list(alice, "wip").expect(404);
  });

  it("requires a trusted Origin for cookie-authenticated writes (CSRF)", async () => {
    await alice.agent.post("/api/posts/hello/comments").set("Origin", "https://evil.example").send({ body: "x" }).expect(403);
  });
});

describe("threads", () => {
  it("lists top-level newest first with replies oldest first; replies to replies attach to the top-level parent", async () => {
    now = mins(0);
    const first = (await post(alice, "hello", { body: "first" }).expect(201)).body.data;
    now = mins(1);
    const second = (await post(bob, "hello", { body: "second" }).expect(201)).body.data;
    now = mins(2);
    const r1 = (await post(bob, "hello", { body: "reply 1", parentId: first.id }).expect(201)).body.data;
    now = mins(3);
    // reply to the reply → attaches to `first`
    const r2 = (await post(alice, "hello", { body: "reply 2", parentId: r1.id }).expect(201)).body.data;
    expect(r1.parentId).toBe(first.id);
    expect(r2.parentId).toBe(first.id);

    const res = await list(admin).expect(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body.meta).toEqual({ page: 1, pageSize: 10, total: 2, totalPages: 1 });
    expect(res.body.data.map((c: { body: string }) => c.body)).toEqual(["second", "first"]);
    const thread = res.body.data[1];
    expect(thread.id).toBe(first.id);
    expect(thread.replies.map((r: { body: string }) => r.body)).toEqual(["reply 1", "reply 2"]);
    expect(thread.replies[0]).not.toHaveProperty("replies");
    expect(res.body.data[0].id).toBe(second.id);
    for (const c of res.body.data) CommentSchema.parse(c);
  });

  it("paginates top-level comments", async () => {
    for (let i = 0; i < 5; i++) {
      now = mins(i);
      await post(alice, "hello", { body: `c${i}` }).expect(201);
    }
    const res = await list(alice, "hello", "?pageSize=2&page=3").expect(200);
    expect(res.body.data.map((c: { body: string }) => c.body)).toEqual(["c0"]);
    expect(res.body.meta).toEqual({ page: 3, pageSize: 2, total: 5, totalPages: 3 });
  });

  it("only allows replying to a visible comment of the SAME post", async () => {
    const c = (await post(alice, "hello", { body: "x" }).expect(201)).body.data;
    await post(bob, "other", { body: "cross-post reply", parentId: c.id }).expect(404);
    await post(bob, "hello", { body: "ghost", parentId: "00000000-0000-4000-8000-000000000000" }).expect(404);
    await t.db.update(comment).set({ status: "hidden" }).where(eq(comment.id, c.id));
    await post(bob, "hello", { body: "to hidden", parentId: c.id }).expect(404);
  });

  it("canEdit/canDelete are viewer specific; anonymous viewers get false", async () => {
    const c = (await post(alice, "hello", { body: "mine" }).expect(201)).body.data;
    const as = async (s: { agent: ReturnType<typeof anonAgent> }) => (await list(s).expect(200)).body.data.find((x: { id: string }) => x.id === c.id);
    expect(await as(alice)).toMatchObject({ canEdit: true, canDelete: true });
    expect(await as(bob)).toMatchObject({ canEdit: false, canDelete: false });
    expect(await as(admin)).toMatchObject({ canEdit: false, canDelete: true });
    expect(await as({ agent: anonAgent(t) })).toMatchObject({ canEdit: false, canDelete: false });
    now = mins(16);
    expect(await as(alice)).toMatchObject({ canEdit: false, canDelete: true });
  });
});

describe("editing", () => {
  it("lets the author edit within 15 minutes, then refuses", async () => {
    const c = (await post(alice, "hello", { body: "original" }).expect(201)).body.data;
    now = mins(14);
    const res = await alice.agent.patch(`/api/comments/${c.id}`).send({ body: "  edited  " }).expect(200);
    expect(res.body.data).toMatchObject({ id: c.id, body: "edited", editedAt: mins(14).toISOString(), canEdit: true });
    now = mins(15.5);
    const late = await alice.agent.patch(`/api/comments/${c.id}`).send({ body: "too late" }).expect(403);
    expect(late.body.error.code).toBe("forbidden");
    expect((await list(alice)).body.data[0].body).toBe("edited");
  });

  it("is author-only, even for admins; requires auth; validates the body", async () => {
    const c = (await post(alice, "hello", { body: "original" }).expect(201)).body.data;
    await bob.agent.patch(`/api/comments/${c.id}`).send({ body: "hijack" }).expect(403);
    await admin.agent.patch(`/api/comments/${c.id}`).send({ body: "hijack" }).expect(403);
    await anonAgent(t).patch(`/api/comments/${c.id}`).send({ body: "x" }).expect(401);
    await alice.agent.patch(`/api/comments/${c.id}`).send({ body: " " }).expect(400);
    await alice.agent.patch(`/api/comments/${c.id}`).send({ body: "x".repeat(4001) }).expect(400);
    await alice.agent.patch(`/api/comments/nope`).send({ body: "x" }).expect(404);
    await alice.agent.patch(`/api/comments/00000000-0000-4000-8000-000000000000`).send({ body: "x" }).expect(404);
  });

  it("cannot edit deleted or hidden comments", async () => {
    const c = (await post(alice, "hello", { body: "original" }).expect(201)).body.data;
    await alice.agent.delete(`/api/comments/${c.id}`).expect(204);
    await alice.agent.patch(`/api/comments/${c.id}`).send({ body: "zombie" }).expect(404);
  });
});

describe("deleting", () => {
  it("soft-deletes: the row stays with status deleted; author or admin only", async () => {
    const c = (await post(alice, "hello", { body: "bye" }).expect(201)).body.data;
    await bob.agent.delete(`/api/comments/${c.id}`).expect(403);
    await anonAgent(t).delete(`/api/comments/${c.id}`).expect(401);
    await alice.agent.delete(`/api/comments/${c.id}`).expect(204);
    await alice.agent.delete(`/api/comments/${c.id}`).expect(204); // idempotent
    const [row] = await t.db.select().from(comment).where(eq(comment.id, c.id));
    expect(row!.status).toBe("deleted");
    expect((await list(alice)).body.data).toEqual([]);
    expect((await list(alice)).body.meta.total).toBe(0);
  });

  it("admins can delete any comment (and it is audited)", async () => {
    const c = (await post(alice, "hello", { body: "rude" }).expect(201)).body.data;
    await admin.agent.delete(`/api/comments/${c.id}`).expect(204);
    const logs = await t.db.select().from(auditLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "comment.delete", targetType: "comment", targetId: c.id, actorId: admin.user.id });
  });

  it("a deleted comment that still has replies is shown as [deleted]", async () => {
    const c = (await post(alice, "hello", { body: "secret words" }).expect(201)).body.data;
    await post(bob, "hello", { body: "a reply", parentId: c.id }).expect(201);
    await alice.agent.delete(`/api/comments/${c.id}`).expect(204);
    const res = await list(bob).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: c.id, body: "[deleted]", status: "deleted", author: { name: "Deleted user", image: null }, canEdit: false, canDelete: false });
    expect(res.body.data[0].replies.map((r: { body: string }) => r.body)).toEqual(["a reply"]);
    expect(JSON.stringify(res.body)).not.toContain("secret words");
  });

  it("deleted replies disappear from the thread", async () => {
    const c = (await post(alice, "hello", { body: "top" }).expect(201)).body.data;
    const r = (await post(bob, "hello", { body: "reply", parentId: c.id }).expect(201)).body.data;
    await bob.agent.delete(`/api/comments/${r.id}`).expect(204);
    expect((await list(alice)).body.data[0].replies).toEqual([]);
  });
});

describe("moderation visibility", () => {
  it("never shows hidden comments (nor the replies under a hidden parent)", async () => {
    const c = (await post(alice, "hello", { body: "bad" }).expect(201)).body.data;
    const r = (await post(bob, "hello", { body: "under bad", parentId: c.id }).expect(201)).body.data;
    const ok = (await post(bob, "hello", { body: "fine" }).expect(201)).body.data;
    await t.db.update(comment).set({ status: "hidden" }).where(eq(comment.id, c.id));
    let res = await list(admin).expect(200);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual([ok.id]);
    expect(JSON.stringify(res.body)).not.toContain("under bad");
    // hidden replies are dropped, hidden-reply parents stay
    await t.db.update(comment).set({ status: "visible" }).where(eq(comment.id, c.id));
    await t.db.update(comment).set({ status: "hidden" }).where(eq(comment.id, r.id));
    res = await list(admin).expect(200);
    expect(res.body.data.find((x: { id: string }) => x.id === c.id).replies).toEqual([]);
  });

  it("the author cannot delete or edit a comment moderators hid", async () => {
    const c = (await post(alice, "hello", { body: "bad" }).expect(201)).body.data;
    await t.db.update(comment).set({ status: "hidden" }).where(eq(comment.id, c.id));
    await alice.agent.delete(`/api/comments/${c.id}`).expect(404);
    await alice.agent.patch(`/api/comments/${c.id}`).send({ body: "x" }).expect(404);
  });
});

describe("reporting", () => {
  it("stores one report per reporter and answers 204", async () => {
    const c = (await post(alice, "hello", { body: "spam" }).expect(201)).body.data;
    await bob.agent.post(`/api/comments/${c.id}/report`).send({ reason: "  spam links  " }).expect(204);
    await bob.agent.post(`/api/comments/${c.id}/report`).send({ reason: "again" }).expect(204);
    await admin.agent.post(`/api/comments/${c.id}/report`).send({ reason: "also spam" }).expect(204);
    const rows = await t.db.select().from(commentReport).where(eq(commentReport.commentId, c.id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.reporterId === bob.user.id)!.reason).toBe("spam links");
    expect(rows.every((r) => r.resolvedAt === null)).toBe(true);
  });

  it("validates reason (3-500), requires auth, and rejects unknown/hidden/own comments", async () => {
    const c = (await post(alice, "hello", { body: "x" }).expect(201)).body.data;
    await bob.agent.post(`/api/comments/${c.id}/report`).send({ reason: "no" }).expect(400);
    await bob.agent.post(`/api/comments/${c.id}/report`).send({ reason: "x".repeat(501) }).expect(400);
    await anonAgent(t).post(`/api/comments/${c.id}/report`).send({ reason: "abuse" }).expect(401);
    await alice.agent.post(`/api/comments/${c.id}/report`).send({ reason: "my own" }).expect(400);
    await bob.agent.post(`/api/comments/00000000-0000-4000-8000-000000000000/report`).send({ reason: "abuse" }).expect(404);
    await t.db.update(comment).set({ status: "hidden" }).where(eq(comment.id, c.id));
    await bob.agent.post(`/api/comments/${c.id}/report`).send({ reason: "abuse" }).expect(404);
  });
});

describe("account deletion", () => {
  it("anonymised users' comments show as [deleted] by Deleted user", async () => {
    const carol = await signUpAndSignIn(t, { name: "Carol" });
    const c = (await post(carol, "hello", { body: "carol was here" }).expect(201)).body.data;
    await post(bob, "hello", { body: "reply", parentId: c.id }).expect(201);
    await carol.agent.delete("/api/me").expect(204);
    const res = await list(bob).expect(200);
    expect(res.body.data[0]).toMatchObject({ body: "[deleted]", author: { name: "Deleted user" } });
    expect(res.body.data[0].replies).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  it("answers 429 with the error envelope after 10 comments per minute per user", async () => {
    const limited = await buildTestApp({ env: { REQUIRE_EMAIL_VERIFICATION: "false", RATE_LIMIT_ENABLED: "1" } });
    try {
      await ensureAuthor(limited);
      await insertPost(limited, { slug: "hello" });
      const u = await createUser(limited);
      const agent = await signIn(limited, u);
      for (let i = 0; i < 10; i++) await agent.post("/api/posts/hello/comments").send({ body: `c${i}` }).expect(201);
      const res = await agent.post("/api/posts/hello/comments").send({ body: "one too many" }).expect(429);
      expect(res.body.error.code).toBe("rate_limited");
      expect(res.headers["retry-after"]).toBeTruthy();
    } finally {
      await limited.close();
    }
  });
});

