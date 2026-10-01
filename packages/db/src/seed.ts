/**
 * Idempotent seed: `pnpm db:seed`.
 *  - always: tags (+ posts when an author exists)
 *  - non-production only: demo users `admin@example.com / admin-password-123` (admin) and
 *    `reader@example.com / reader-password-123`, a few comments, two newsletter subscribers.
 * Safe to run repeatedly: everything is keyed by slug / email and existing rows are updated in place.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readingMinutes, toExcerpt, toPlainText, validateContent, type Content } from "@blog/content";
import { and, eq, inArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { closeDb, getDb, DEFAULT_DATABASE_URL, type Database } from "./client";
import { account, comment, post, postTag, subscriber, tag, user } from "./schema/index";
import { SEED_POSTS, SEED_TAGS } from "./seed-content";

export const DEMO_ADMIN = { email: "admin@example.com", password: "admin-password-123", name: "Demo Admin" } as const;
export const DEMO_READER = { email: "reader@example.com", password: "reader-password-123", name: "Demo Reader" } as const;

export interface SeedOptions {
  /** Create demo users/comments/subscribers. Default: NODE_ENV !== "production". */
  demoData?: boolean;
  log?: (msg: string) => void;
}

export interface SeedResult {
  tags: number;
  posts: number;
  users: number;
  comments: number;
}

async function upsertUser(db: Database, u: { email: string; password: string; name: string }, role: "admin" | "reader"): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, u.email)).limit(1);
  const id = existing?.id ?? randomUUID();
  if (existing) {
    await db.update(user).set({ role, emailVerified: true, banned: false, banReason: null }).where(eq(user.id, id));
  } else {
    await db.insert(user).values({ id, name: u.name, email: u.email, emailVerified: true, role });
  }
  const [cred] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, id), eq(account.providerId, "credential"))).limit(1);
  if (!cred) {
    // Better Auth's own scrypt hasher, so these accounts can really sign in.
    await db.insert(account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(u.password) });
  }
  return id;
}

export async function seed(db: Database, options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);
  const demo = options.demoData ?? process.env.NODE_ENV !== "production";
  const result: SeedResult = { tags: 0, posts: 0, users: 0, comments: 0 };

  // --- tags -------------------------------------------------------------------------------------------------------
  for (const t of SEED_TAGS) {
    await db.insert(tag).values(t).onConflictDoUpdate({ target: tag.slug, set: { name: t.name } });
    result.tags++;
  }
  const tagRows = await db.select().from(tag).where(inArray(tag.slug, SEED_TAGS.map((t) => t.slug)));
  const tagId = new Map(tagRows.map((t) => [t.slug, t.id]));

  // --- users ------------------------------------------------------------------------------------------------------
  let adminId: string | undefined;
  let readerId: string | undefined;
  if (demo) {
    adminId = await upsertUser(db, DEMO_ADMIN, "admin");
    readerId = await upsertUser(db, DEMO_READER, "reader");
    result.users = 2;
    log(`demo users: ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}, ${DEMO_READER.email} / ${DEMO_READER.password}`);
  } else {
    const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.role, "admin")).limit(1);
    adminId = admin?.id;
  }

  // --- posts ------------------------------------------------------------------------------------------------------
  if (!adminId) {
    log("no admin user exists: skipping posts (create an admin with `pnpm --filter @blog/api make-admin <email>` and re-run)");
  } else {
    for (const sp of SEED_POSTS) {
      const check = validateContent(sp.content);
      if (!check.ok) throw new Error(`seed post "${sp.slug}" has invalid content: ${JSON.stringify(check.errors)}`);
      const content = sp.content as unknown as Content;
      const published = sp.status === "published";
      const values = {
        title: sp.title,
        section: sp.section,
        status: sp.status,
        content: sp.content,
        contentText: toPlainText(content),
        excerpt: sp.excerpt ?? toExcerpt(content, 200),
        readingMinutes: Math.max(1, readingMinutes(content)),
        coverImageUrl: sp.cover?.url ?? null,
        coverImageAlt: sp.cover?.alt ?? null,
        authorId: adminId,
        publishedAt: published ? new Date(sp.publishedAt ?? Date.now()) : null,
      };
      const [row] = await db
        .insert(post)
        .values({ slug: sp.slug, ...values })
        .onConflictDoUpdate({ target: post.slug, set: values })
        .returning({ id: post.id });
      const postId = row!.id;
      await db.delete(postTag).where(eq(postTag.postId, postId));
      const ids = sp.tags.map((s) => tagId.get(s)).filter((v): v is string => Boolean(v));
      if (ids.length) await db.insert(postTag).values(ids.map((tid) => ({ postId, tagId: tid })));
      result.posts++;
    }
    log(`posts: ${result.posts} (${SEED_POSTS.filter((p) => p.status === "published").length} published)`);
  }

  // --- comments + subscribers (demo only) ---------------------------------------------------------------------------
  if (demo && adminId && readerId) {
    const published = await db.select({ id: post.id, slug: post.slug }).from(post).where(inArray(post.slug, SEED_POSTS.filter((p) => p.status === "published").map((p) => p.slug)));
    const bySlug = new Map(published.map((p) => [p.slug, p.id]));
    const addComment = async (postSlug: string, authorId: string, body: string, parentId?: string): Promise<string | undefined> => {
      const postId = bySlug.get(postSlug);
      if (!postId) return undefined;
      const [existing] = await db.select({ id: comment.id }).from(comment).where(and(eq(comment.postId, postId), eq(comment.authorId, authorId), eq(comment.body, body))).limit(1);
      if (existing) return existing.id;
      const [row] = await db.insert(comment).values({ postId, authorId, body, parentId: parentId ?? null }).returning({ id: comment.id });
      result.comments++;
      return row!.id;
    };
    const c1 = await addComment("postgres-full-text-search-with-weighted-ranking", readerId, "Great walkthrough! Does the generated column make writes noticeably slower?");
    if (c1) await addComment("postgres-full-text-search-with-weighted-ranking", adminId, "Only marginally: the vector is recomputed when title, excerpt or text change, which for a blog is rare.", c1);
    await addComment("notes-from-a-slow-morning", readerId, "This made me put my phone down for a few minutes. Thank you.");

    for (const [email, status] of [["fan@example.com", "confirmed"], ["curious@example.com", "pending"]] as const) {
      await db
        .insert(subscriber)
        .values({
          email,
          status,
          source: "seed",
          unsubscribeToken: randomBytes(24).toString("base64url"),
          confirmToken: status === "pending" ? randomBytes(24).toString("base64url") : null,
          confirmedAt: status === "confirmed" ? new Date() : null,
        })
        .onConflictDoNothing({ target: subscriber.email });
    }
  }
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  console.log(`[seed] ${url.replace(/:\/\/[^@]*@/, "://***@")}`);
  seed(getDb(), { log: (m) => console.log(`[seed] ${m}`) })
    .then((r) => console.log(`[seed] done: ${r.tags} tags, ${r.posts} posts, ${r.users} users, ${r.comments} new comments`))
    .catch((err) => {
      console.error("[seed] failed:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
