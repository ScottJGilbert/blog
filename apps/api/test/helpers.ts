/**
 * Integration-test harness (real Postgres, real Better Auth, fake outside world).
 *
 *   let t: TestApp;
 *   beforeAll(async () => { t = await buildTestApp(); });
 *   afterAll(() => t.close());
 *   beforeEach(() => t.reset());              // truncates all tables + clears the mailbox
 *
 *   it("…", async () => {
 *     const admin = await signUpAndSignIn(t, { role: "admin" });
 *     const res = await admin.agent.get("/api/admin/stats").expect(200);   // cookies + Origin header preset
 *     const anon = anonAgent(t);                                          // no cookies, Origin preset
 *   });
 *
 * Each test FILE gets its own throw-away database (see `@blog/db/testing`), so files can run in parallel.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { account, createDb, type Database, type User, user } from "@blog/db";
import { createTestDb, type TestDb } from "@blog/db/testing";
import { hashPassword } from "better-auth/crypto";
import type { Express } from "express";
import request from "supertest";
import { createAppWithDeps } from "../src/app";
import { loadConfig, type Config } from "../src/config";
import type { Deps, DepsOverrides } from "../src/deps";
import { createLogger } from "../src/logger";
import { MemoryMailer, findLink } from "../src/services/mailer";
import { MemoryStorage } from "../src/services/storage";
import { NoopProvider, type NewsletterProvider } from "../src/services/newsletter";
import { DisabledProvider, type EmbeddingProvider } from "../src/services/embeddings";

export type TestAgent = ReturnType<typeof request.agent>;

export const TEST_PASSWORD = "correct-horse-battery-staple";
export const TEST_SITE_URL = "http://localhost:3000";

export interface TestApp {
  app: Express;
  deps: Deps;
  config: Config;
  db: Database;
  /** Captures every email the app sends. */
  mailer: MemoryMailer;
  storage: MemoryStorage;
  /** `Origin` header value that passes the CSRF check. */
  origin: string;
  /** Delete all rows + clear the mailbox (call in `beforeEach`). */
  reset(): Promise<void>;
  /** Drop the throw-away database and close pools. Call in `afterAll`. */
  close(): Promise<void>;
}

export interface BuildTestAppOptions {
  /** Extra env vars for `loadConfig` (e.g. `{ ADMIN_EMAILS: "boss@example.com", REQUIRE_EMAIL_VERIFICATION: "false" }`). */
  env?: Record<string, string>;
  /** Override any dependency (e.g. `{ newsletter: fakeProvider, embeddings: fakeEmbeddings, now: () => date }`). */
  deps?: Omit<DepsOverrides, "config" | "db">;
}

export async function buildTestApp(options: BuildTestAppOptions = {}): Promise<TestApp> {
  const testDb: TestDb = await createTestDb();
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "blog-api-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: testDb.url,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
    BETTER_AUTH_URL: TEST_SITE_URL,
    SITE_URL: TEST_SITE_URL,
    UPLOAD_DIR: uploadDir,
    ...options.env,
  });
  // The app gets its own pool on the same throw-away database.
  const handle = createDb(testDb.url, { max: 5 });
  const mailer = options.deps?.mailer instanceof MemoryMailer ? options.deps.mailer : new MemoryMailer();
  const storage = options.deps?.storage instanceof MemoryStorage ? options.deps.storage : new MemoryStorage(`${config.basePath}/media/files`);
  const logger = options.deps?.logger ?? createLogger(config);
  const newsletter: NewsletterProvider = options.deps?.newsletter ?? new NoopProvider(logger);
  const embeddings: EmbeddingProvider = options.deps?.embeddings ?? new DisabledProvider();

  const { app, deps } = createAppWithDeps({
    ...options.deps,
    config,
    logger,
    db: handle.db,
    mailer,
    storage,
    newsletter,
    embeddings,
    // never talk to a real web app from tests unless a test injects its own fetch/revalidate
    revalidate: options.deps?.revalidate ?? (async () => undefined),
  });

  return {
    app,
    deps,
    config,
    db: handle.db,
    mailer,
    storage,
    origin: TEST_SITE_URL,
    async reset() {
      await testDb.truncateAll();
      mailer.clear();
      storage.objects.clear();
    },
    async close() {
      await handle.close();
      await testDb.close();
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
}

/** A supertest agent that keeps cookies and sends a trusted `Origin` header (state-changing requests need one). */
export function anonAgent(t: Pick<TestApp, "app" | "origin">): TestAgent {
  return request.agent(t.app).set("Origin", t.origin);
}

export interface CreateUserOptions {
  email?: string;
  name?: string;
  password?: string;
  role?: "reader" | "admin";
  /** default true */
  verified?: boolean;
  banned?: boolean;
}

export interface TestUser extends User {
  password: string;
}

let counter = 0;

/** Insert a user (+ credential account with a real Better Auth password hash) directly in the DB. */
export async function createUser(t: Pick<TestApp, "db">, o: CreateUserOptions = {}): Promise<TestUser> {
  const n = ++counter;
  const password = o.password ?? TEST_PASSWORD;
  const id = randomUUID();
  const email = (o.email ?? `user${n}-${id.slice(0, 6)}@example.com`).toLowerCase();
  const [row] = await t.db
    .insert(user)
    .values({
      id,
      name: o.name ?? `Test User ${n}`,
      email,
      emailVerified: o.verified ?? true,
      role: o.role ?? "reader",
      banned: o.banned ?? false,
    })
    .returning();
  await t.db.insert(account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(password) });
  return { ...row!, password };
}

export interface TestSession {
  /** supertest agent with the session cookie + Origin preset */
  agent: TestAgent;
  user: TestUser;
  email: string;
  password: string;
}

/** Sign in through the REAL Better Auth endpoint and return an agent holding the session cookie. */
export async function signIn(t: TestApp, u: { email: string; password: string }): Promise<TestAgent> {
  const agent = anonAgent(t);
  const res = await agent.post(`${t.config.basePath}/auth/sign-in/email`).send({ email: u.email, password: u.password });
  if (res.status !== 200) {
    throw new Error(`test sign-in failed (${res.status}): ${JSON.stringify(res.body)} — is the user verified (REQUIRE_EMAIL_VERIFICATION)?`);
  }
  return agent;
}

/**
 * Create a user (verified by default; `role: "admin"` for an admin) and sign in.
 *   const { agent, user } = await signUpAndSignIn(t, { role: "admin" });
 */
export async function signUpAndSignIn(t: TestApp, o: CreateUserOptions = {}): Promise<TestSession> {
  const u = await createUser(t, o);
  const agent = await signIn(t, u);
  return { agent, user: u, email: u.email, password: u.password };
}

/**
 * Full public flow: POST sign-up, then follow the verification link from the captured mail.
 * Returns the agent (signed in by `autoSignInAfterVerification`) and the email used.
 */
export async function signUpViaApiAndVerify(t: TestApp, o: { email?: string; name?: string; password?: string } = {}) {
  const email = (o.email ?? `flow-${randomUUID().slice(0, 8)}@example.com`).toLowerCase();
  const password = o.password ?? TEST_PASSWORD;
  const agent = anonAgent(t);
  await agent.post(`${t.config.basePath}/auth/sign-up/email`).send({ email, password, name: o.name ?? "Flow User" }).expect(200);
  const mail = t.mailer.last(email);
  if (!mail) throw new Error("no verification email was sent");
  const link = findLink(mail, /verify-email/);
  if (!link) throw new Error(`no verification link in mail: ${mail.text}`);
  const u = new URL(link);
  await agent.get(`${u.pathname}${u.search}`).expect((r) => {
    if (r.status >= 400) throw new Error(`verification failed: ${r.status} ${JSON.stringify(r.body)}`);
  });
  return { agent, email, password };
}

export { MemoryMailer, MemoryStorage, findLink };
