import { randomUUID } from "node:crypto";
import type { Database } from "../src/client";
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
