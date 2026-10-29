import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { DEFAULT_TEST_DATABASE_URL, type Database } from "../src/client";
import { post, user, type LexicalJson } from "../src/schema/index";

export function lexical(text = "hello"): LexicalJson {
  return {
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          children: [{ type: "text", version: 1, text, format: 0, detail: 0, mode: "normal", style: "" }],
        },
      ],
    },
  };
}

export async function insertUser(db: Database, over: Partial<typeof user.$inferInsert> = {}) {
  const id = over.id ?? randomUUID();
  const [row] = await db
    .insert(user)
    .values({ id, name: "Test User", email: `${id}@example.com`, ...over })
    .returning();
  return row!;
}

export async function insertPost(db: Database, authorId: string, over: Partial<typeof post.$inferInsert> = {}) {
  const [row] = await db
    .insert(post)
    .values({
      slug: `post-${randomUUID().slice(0, 8)}`,
      title: "A post",
      section: "engineering",
      content: lexical(),
      authorId,
      ...over,
    })
    .returning();
  return row!;
}

/** Postgres error code (23505 unique, 23503 fk, 23514 check) of a drizzle/pg rejection. */
export async function pgErrorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
}

/** A new, EMPTY (not migrated) database next to TEST_DATABASE_URL, for tests that must prepare roles/extensions before migrating. */
export async function createEmptyDb(): Promise<{ url: string; adminQuery: (sql: string) => Promise<void>; drop(): Promise<void> }> {
  const base = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  const name = `blog_test_x_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const at = (db: string) => {
    const u = new URL(base);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const adminQuery = async (text: string) => {
    const c = new pg.Client({ connectionString: at("postgres") });
    await c.connect();
    try {
      await c.query(text);
    } finally {
      await c.end();
    }
  };
  await adminQuery(`create database "${name}"`);
  return { url: at(name), adminQuery, drop: () => adminQuery(`drop database if exists "${name}" with (force)`) };
}

/** Run SQL on a database as a plain client (optionally `SET ROLE`d first); resolves with the rows, rejects with the pg error. */
export async function queryAs(url: string, role: string | null, text: string): Promise<Record<string, unknown>[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    if (role) await c.query(`set role ${role}`);
    return (await c.query(text)).rows;
  } finally {
    await c.end();
  }
}
