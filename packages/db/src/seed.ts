/**
 * Idempotent seed: `pnpm db:seed` locally, `SEED_ON_BUILD=1` on Vercel previews (see migrate-on-build.ts).
 *  - always: tags (+ posts when an author exists)
 *  - local dev only (NODE_ENV !== production AND not on Vercel): the PUBLIC demo users `admin@example.com / admin-password-123`
 *    (admin) and `reader@example.com / reader-password-123`, a few comments, two newsletter subscribers.
 *  - real accounts (any environment, the only kind created on Vercel): admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, optional
 *    verified reader from `SEED_READER_EMAIL` / `SEED_READER_PASSWORD`. Passwords need >= 16 characters and must not be a known default;
 *    an existing account keeps its password unless `SEED_RESET_PASSWORDS=1`.
 * Safe to run repeatedly: everything is keyed by slug / email and existing rows are updated in place.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readingMinutes, toExcerpt, toPlainText, validateContent, type Content } from "@blog/content";
import { and, eq, inArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { closeDb, getDb, redactUrl, resolveDatabaseUrl, DEFAULT_DATABASE_URL, type Database } from "./client";
import { account, comment, post, postTag, subscriber, tag, user } from "./schema/index";
import { SEED_POSTS, SEED_TAGS } from "./seed-content";

export const DEMO_ADMIN = { email: "admin@example.com", password: "admin-password-123", name: "Demo Admin" } as const;
export const DEMO_READER = { email: "reader@example.com", password: "reader-password-123", name: "Demo Reader" } as const;

export interface SeedAccount {
  email: string;
  password: string;
  name?: string;
}

export interface SeedAccounts {
  admin?: SeedAccount;
  reader?: SeedAccount;
}

export interface SeedOptions {
  /** Create the public demo users/comments/subscribers. Default: NODE_ENV !== "production". Always refused on Vercel (VERCEL / VERCEL_ENV set). */
  demoData?: boolean;
  /** Real accounts to create instead of the demo ones (see `seedAccountsFromEnv`). */
  accounts?: SeedAccounts;
  /** Overwrite the password of an account that already exists (default: leave it alone). */
  resetPasswords?: boolean;
  /** Do not touch posts that already exist (so edits made on a preview survive a re-seed). */
  keepExistingPosts?: boolean;
  /** Default process.env. */
  env?: Record<string, string | undefined>;
  log?: (msg: string) => void;
}

export const MIN_SEED_PASSWORD_LENGTH = 16;
const KNOWN_DEFAULT_PASSWORDS = new Set<string>([DEMO_ADMIN.password, DEMO_READER.password]);
const OBVIOUS_PASSWORD = /^(change-?me|password|admin-?password|reader-?password|letmein|qwerty|123456)/i;
const truthy = (v: string | undefined) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Accounts from `SEED_ADMIN_*` / `SEED_READER_*`. Invalid or missing entries are left out and described in `problems` (variable
 * NAMES only, never values) so the caller can log them loudly.
 */
export function seedAccountsFromEnv(env: Record<string, string | undefined> = process.env): { accounts: SeedAccounts; problems: string[] } {
  const problems: string[] = [];
  const read = (prefix: "ADMIN" | "READER", name: string): SeedAccount | undefined => {
    const email = env[`SEED_${prefix}_EMAIL`]?.trim().toLowerCase();
    const password = env[`SEED_${prefix}_PASSWORD`];
    if (!email && !password) {
      if (prefix === "ADMIN") problems.push("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are not set: no admin account is created");
      return undefined;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void problems.push(`SEED_${prefix}_EMAIL is missing or not an email address: ${prefix.toLowerCase()} account skipped`);
    if (!password || password.length < MIN_SEED_PASSWORD_LENGTH) return void problems.push(`SEED_${prefix}_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters: ${prefix.toLowerCase()} account skipped`);
    if (KNOWN_DEFAULT_PASSWORDS.has(password) || OBVIOUS_PASSWORD.test(password)) return void problems.push(`SEED_${prefix}_PASSWORD is a known default / placeholder password: ${prefix.toLowerCase()} account skipped`);
    return { email, password, name };
  };
  const admin = read("ADMIN", "Admin");
  const reader = read("READER", "Reader");
  if (admin && reader && admin.email === reader.email) {
    problems.push("SEED_READER_EMAIL equals SEED_ADMIN_EMAIL: reader account skipped");
    return { accounts: { admin }, problems };
  }
  return { accounts: { ...(admin && { admin }), ...(reader && { reader }) }, problems };
}

export interface SeedResult {
  tags: number;
  posts: number;
  users: number;
  comments: number;
}

async function upsertUser(
  db: Database,
  u: { email: string; password: string; name: string },
  role: "admin" | "reader",
  o: { resetPassword?: boolean; restoreAccess?: boolean } = {},
): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, u.email)).limit(1);
  const id = existing?.id ?? randomUUID();
  if (existing) {
    // Only the demo accounts un-ban and re-role; a real reader keeps whatever role/ban moderation gave them.
    const patch = o.restoreAccess ? { role, emailVerified: true, banned: false, banReason: null } : role === "admin" ? { role, emailVerified: true } : { emailVerified: true };
    await db.update(user).set(patch).where(eq(user.id, id));
  } else {
    await db.insert(user).values({ id, name: u.name, email: u.email, emailVerified: true, role });
  }
  const [cred] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, id), eq(account.providerId, "credential"))).limit(1);
  if (!cred) {
    // Better Auth's own scrypt hasher, so these accounts can really sign in.
    await db.insert(account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(u.password) });
  } else if (o.resetPassword) {
    await db.update(account).set({ password: await hashPassword(u.password), updatedAt: new Date() }).where(eq(account.id, cred.id));
  }
  return id;
}

export async function seed(db: Database, options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);
  const env = options.env ?? process.env;
  const onVercel = Boolean(env.VERCEL_ENV || env.VERCEL);
  const real = options.accounts && (options.accounts.admin || options.accounts.reader) ? options.accounts : undefined;
  const wantsDemo = !real && (options.demoData ?? env.NODE_ENV !== "production");
  // The demo passwords are public: they must never exist in a deployed database, whatever the caller asked for.
  if (wantsDemo && onVercel) log("refusing to create the public demo accounts on Vercel (set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD instead)");
  const demo = wantsDemo && !onVercel;
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
    adminId = await upsertUser(db, DEMO_ADMIN, "admin", { restoreAccess: true });
    readerId = await upsertUser(db, DEMO_READER, "reader", { restoreAccess: true });
    result.users = 2;
    log(`demo users: ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}, ${DEMO_READER.email} / ${DEMO_READER.password}`);
  } else {
    const o = { resetPassword: options.resetPasswords };
    if (real?.admin) {
      adminId = await upsertUser(db, { name: "Admin", ...real.admin }, "admin", o);
      result.users++;
      log(`admin account: ${maskEmail(real.admin.email)}`);
    }
    if (real?.reader) {
      await upsertUser(db, { name: "Reader", ...real.reader }, "reader", o);
      result.users++;
      log(`reader account: ${maskEmail(real.reader.email)}`);
    }
    if (!adminId) {
      const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.role, "admin")).limit(1);
      adminId = admin?.id;
    }
  }

  // --- posts ------------------------------------------------------------------------------------------------------
  if (!adminId) {
    log("no admin user exists: skipping posts (create an admin with `pnpm --filter @blog/api make-admin <email>` and re-run)");
  } else {
    for (const sp of SEED_POSTS) {
      if (options.keepExistingPosts && (await db.select({ id: post.id }).from(post).where(eq(post.slug, sp.slug)).limit(1)).length > 0) continue;
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

/**
 * The seed run by `SEED_ON_BUILD=1` on Vercel (and by `pnpm db:seed` when `VERCEL_ENV` is set): demo tags and posts, plus the real
 * accounts from `SEED_*`. Never the public demo accounts. Problems are logged loudly and never include a password.
 */
export async function seedDeployment(db: Database, env: Record<string, string | undefined> = process.env, log: (msg: string) => void = console.log): Promise<SeedResult> {
  const { accounts, problems } = seedAccountsFromEnv(env);
  for (const p of problems) log(`WARNING ${p}`);
  return seed(db, { demoData: false, accounts, resetPasswords: truthy(env.SEED_RESET_PASSWORDS), keepExistingPosts: true, env, log });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = resolveDatabaseUrl() ?? DEFAULT_DATABASE_URL;
  console.log(`[seed] ${redactUrl(url)}`);
  const log = (m: string) => console.log(`[seed] ${m}`);
  const { accounts } = seedAccountsFromEnv();
  const run = process.env.VERCEL_ENV ? seedDeployment(getDb(), process.env, log) : seed(getDb(), { accounts, resetPasswords: truthy(process.env.SEED_RESET_PASSWORDS), log });
  run
    .then((r) => console.log(`[seed] done: ${r.tags} tags, ${r.posts} posts, ${r.users} users, ${r.comments} new comments`))
    .catch((err) => {
      console.error("[seed] failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
