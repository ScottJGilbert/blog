import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client";
import { runMigrations } from "../src/migrate";
import { EMBEDDING_DIMENSIONS, postEmbedding } from "../src/schema/index";
import { createTestDb } from "../src/testing";
import { vectorSchema, vectorSql } from "../src/vector";
import { createEmptyDb, insertPost, insertUser } from "./helpers";

const vec = (x: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? x : i === 1 ? 1 : 0));

/** Where pgvector's type lives, and whether an HNSW cosine index exists on post_embedding. */
async function inspect(h: DbHandle) {
  const ext = await h.pool.query("select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'");
  const idx = await h.pool.query("select indexdef from pg_indexes where tablename = 'post_embedding' and indexdef like '%hnsw%'");
  return { schema: ext.rows[0]?.nspname as string | undefined, hnsw: idx.rowCount === 1 };
}

/** Insert two embeddings and run the same cosine-distance ordering the API uses. */
async function similarityOrder(h: DbHandle): Promise<string[]> {
  const author = await insertUser(h.db);
  const a = await insertPost(h.db, author.id, { slug: "a" });
  const b = await insertPost(h.db, author.id, { slug: "b" });
  await h.db.insert(postEmbedding).values([
    { postId: a.id, model: "m", contentHash: "a", embedding: vec(1) },
    { postId: b.id, model: "m", contentHash: "b", embedding: vec(-1) },
  ]);
  const v = await vectorSql(h.db);
  const query = sql`${JSON.stringify(vec(1))}::${v.type}`;
  const rows = await h.db.execute<{ slug: string }>(sql`
    select p.slug from post_embedding e join post p on p.id = e.post_id
    order by ${v.cosineDistance(sql`e.embedding`, query)}`);
  return rows.rows.map((r) => r.slug);
}

describe("pgvector in the Supabase `extensions` schema", () => {
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  /** A database like Supabase's, but whose connections do NOT have `extensions` on the search_path. */
  async function supabaseLikeDb(preinstall: boolean) {
    const empty = await createEmptyDb();
    cleanups.push(() => empty.drop());
    const admin = createDb(empty.url, { max: 1 });
    await admin.pool.query("create schema extensions");
    if (preinstall) await admin.pool.query("create extension vector with schema extensions"); // "enabled in the dashboard"
    await admin.pool.query(`alter database "${new URL(empty.url).pathname.slice(1)}" set search_path = public`);
    await admin.close();
    const h = createDb(empty.url, { max: 2 });
    cleanups.push(() => h.close());
    expect((await h.pool.query("show search_path")).rows[0].search_path).toBe("public");
    return h;
  }

  it("extension created by the migrator in `extensions` when that schema exists: migrations, HNSW index and queries work", async () => {
    const h = await supabaseLikeDb(false);
    await runMigrations(h.db);
    expect(await inspect(h)).toEqual({ schema: "extensions", hnsw: true });
    expect(await vectorSchema(h.db)).toBe("extensions");
    // control: the unqualified spelling the API used to have really fails here
    await expect(h.pool.query(`select '[1,2]'::vector`)).rejects.toThrow(/type "vector" does not exist/);
    expect(await similarityOrder(h)).toEqual(["a", "b"]);
  });

  it("extension enabled beforehand (dashboard) in `extensions`, search_path without it: migration 0000 still resolves vector(1536) and vector_cosine_ops", async () => {
    const h = await supabaseLikeDb(true);
    await runMigrations(h.db);
    expect(await inspect(h)).toEqual({ schema: "extensions", hnsw: true });
    expect(await similarityOrder(h)).toEqual(["a", "b"]);
    await runMigrations(h.db); // idempotent
  });

  it("plain Postgres: extension in public, same code path", async () => {
    const t = await createTestDb();
    cleanups.push(() => t.close());
    expect(await inspect(t)).toEqual({ schema: "public", hnsw: true });
    expect(await vectorSchema(t.db)).toBe("public");
    expect(await similarityOrder(t)).toEqual(["a", "b"]);
  });
});
