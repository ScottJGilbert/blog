import { eq, post, subscriber, user, comment, commentReport, newsletter } from "@blog/db";
import { randomUUID } from "node:crypto";
import { signUpAndSignIn, createUser, anonAgent, type TestApp, type TestAgent } from "../helpers";

export { signUpAndSignIn, createUser, anonAgent };

/** Minimal valid Lexical document: one paragraph per string. */
export function doc(...paragraphs: string[]) {
  return {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: paragraphs.map((text) => ({
        type: "paragraph",
        version: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        children: [{ type: "text", version: 1, text, format: 0, style: "", mode: "normal", detail: 0 }],
      })),
    },
  };
}

export function docWithImage(src: string, alt = "an image") {
  const d = doc("Intro paragraph");
  (d.root.children as unknown[]).push({ type: "image", version: 1, src, altText: alt, width: 0, height: 0, maxWidth: 500, showCaption: false });
  return d;
}

export interface Admin {
  agent: TestAgent;
  user: Awaited<ReturnType<typeof signUpAndSignIn>>["user"];
}

export async function adminSession(t: TestApp): Promise<Admin> {
  const s = await signUpAndSignIn(t, { role: "admin" });
  return { agent: s.agent, user: s.user };
}

export const API = "/api/admin";

export async function createPostVia(agent: TestAgent, overrides: Record<string, unknown> = {}) {
  const res = await agent
    .post(`${API}/posts`)
    .send({ title: "Hello World", section: "engineering", tags: [], content: doc("Hello there, this is the body."), ...overrides })
    .expect(201);
  return res.body.data as {
    id: string;
    slug: string;
    status: string;
    [k: string]: any;
  };
}

/** Insert a post straight into the DB (any status), authored by `authorId`. */
export async function insertPost(
  t: TestApp,
  authorId: string,
  o: Partial<typeof post.$inferInsert> = {},
): Promise<typeof post.$inferSelect> {
  const [row] = await t.db
    .insert(post)
    .values({
      slug: `p-${randomUUID().slice(0, 8)}`,
      title: "Seeded post",
      excerpt: "excerpt",
      section: "engineering",
      status: "draft",
      content: doc("Seeded body text.") as never,
      contentText: "Seeded body text.",
      authorId,
      ...o,
    })
    .returning();
  return row!;
}

export async function insertComment(t: TestApp, postId: string, authorId: string | null, o: Partial<typeof comment.$inferInsert> = {}) {
  const [row] = await t.db
    .insert(comment)
    .values({ postId, authorId, body: "A comment", ...o })
    .returning();
  return row!;
}

export async function insertReport(t: TestApp, commentId: string, reporterId: string, reason = "spam spam") {
  const [row] = await t.db.insert(commentReport).values({ commentId, reporterId, reason }).returning();
  return row!;
}

export async function insertSubscriber(t: TestApp, o: Partial<typeof subscriber.$inferInsert> & { email: string }) {
  const [row] = await t.db
    .insert(subscriber)
    .values({ unsubscribeToken: randomUUID().replaceAll("-", ""), status: "confirmed", ...o })
    .returning();
  return row!;
}

export async function insertNewsletter(t: TestApp, o: Partial<typeof newsletter.$inferInsert> = {}) {
  const [row] = await t.db
    .insert(newsletter)
    .values({ subject: "Subject", content: doc("Newsletter body") as never, html: "<p>x</p>", ...o })
    .returning();
  return row!;
}

export async function auditActions(t: TestApp): Promise<string[]> {
  const { auditLog } = await import("@blog/db");
  const rows = await t.db.select({ action: auditLog.action }).from(auditLog).orderBy(auditLog.createdAt);
  return rows.map((r) => r.action);
}

export async function getUser(t: TestApp, id: string) {
  const [u] = await t.db.select().from(user).where(eq(user.id, id));
  return u;
}
