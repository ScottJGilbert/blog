import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client";
import { runMigrations } from "../src/migrate";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("migrations", () => {
  it("apply cleanly a second time (idempotent) and concurrently", async () => {
    await runMigrations(t.db);
    const other = createDb(t.url, { max: 2 });
    try {
      await Promise.all([runMigrations(t.db), runMigrations(other.db)]);
    } finally {
      await other.close();
    }
    const { rows } = await t.pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("creates the vector extension and every SPEC table", async () => {
    const ext = await t.pool.query("select extname from pg_extension where extname = 'vector'");
    expect(ext.rowCount).toBe(1);
    const { rows } = await t.pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by 1",
    );
    expect(rows.map((r) => r.tablename)).toEqual(
      [
        "account", "api_key", "audit_log", "comment", "comment_report", "media", "newsletter", "post",
        "post_embedding", "post_tag", "session", "subscriber", "tag", "user", "verification",
      ].sort(),
    );
  });

  it("has a GIN index on post.search_vector and an HNSW cosine index on post_embedding.embedding", async () => {
    const { rows } = await t.pool.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('post','post_embedding')",
    );
    const gin = rows.find((r) => /USING gin \(search_vector\)/.test(r.indexdef));
    expect(gin).toBeTruthy();
    const hnsw = rows.find((r) => /USING hnsw \(embedding vector_cosine_ops\)/.test(r.indexdef));
    expect(hnsw).toBeTruthy();
  });
});
