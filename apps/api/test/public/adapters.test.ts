import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp, type TestApp } from "../helpers";
import { createVectorStore, PgVectorStore, SupabaseVectorStore } from "../../src/services/vectors";
import { createStorage, SupabaseStorage } from "../../src/services/storage";
import { BASE, ensureAuthor, FakeEmbeddings, insertPost } from "./fixtures";

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ env: { VECTOR_DRIVER: "supabase", STORAGE_DRIVER: "supabase" }, deps: { now: () => BASE, embeddings: new FakeEmbeddings() } });
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await ensureAuthor(t);
});

describe("per-capability drivers", () => {
  it("VECTOR_DRIVER / STORAGE_DRIVER pick the adapter; the default is pgvector", async () => {
    expect(t.config.vectors.driver).toBe("supabase");
    expect(createVectorStore(t.config, t.db)).toBeInstanceOf(SupabaseVectorStore);
    expect(createVectorStore({ ...t.config, vectors: { driver: "pgvector" } }, t.db)).toBeInstanceOf(PgVectorStore);
    expect(createStorage(t.config)).toBeInstanceOf(SupabaseStorage);
  });

  it("the unwritten Supabase placeholders fail with 501 on writes but never break reads (search → full-text, related → tags)", async () => {
    await expect(new SupabaseVectorStore().upsert()).rejects.toMatchObject({ status: 501 });
    await expect(new SupabaseStorage().put()).rejects.toMatchObject({ status: 501 });
    await new SupabaseStorage().delete(); // deleting a media row must keep working
    await insertPost(t, { slug: "alpha-one", title: "alpha one", markdown: "alpha body" });
    await insertPost(t, { slug: "alpha-two", title: "alpha two", markdown: "alpha too" });
    const search = await request(t.app).get("/api/search").query({ q: "alpha" });
    expect(search.status).toBe(200);
    expect(search.body.data.length).toBe(2);
    const related = await request(t.app).get("/api/posts/alpha-one/related");
    expect(related.status).toBe(200);
  });
});
