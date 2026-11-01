import { eq, inArray, postEmbedding, sql, vectorSql, type Database, type SQL } from "@blog/db";
import type { VectorFilter, VectorHit, VectorStore } from "./types";

const vectorLiteral = (v: number[]): string => `[${v.join(",")}]`;

/** pgvector in the app's own Postgres (`post_embedding`): plain Postgres, docker compose and Supabase alike. */
export class PgVectorStore implements VectorStore {
  readonly driver = "pgvector";

  constructor(private readonly db: Database) {}

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.db.execute(query)).rows as T[];
  }

  private eligible(f: VectorFilter): SQL {
    const section = f.section ? sql`AND p.section = ${f.section}` : sql``;
    return sql`p.status = 'published' AND p.published_at <= ${f.publishedAt.toISOString()}::timestamptz ${section}`;
  }

  async contentHashes(postIds: string[]): Promise<Map<string, string>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.db
      .select({ postId: postEmbedding.postId, hash: postEmbedding.contentHash })
      .from(postEmbedding)
      .where(inArray(postEmbedding.postId, postIds));
    return new Map(rows.map((r) => [r.postId, r.hash]));
  }

  async has(postId: string): Promise<boolean> {
    const rows = await this.db.select({ id: postEmbedding.postId }).from(postEmbedding).where(eq(postEmbedding.postId, postId)).limit(1);
    return rows.length > 0;
  }

  async upsert(postId: string, e: { model: string; contentHash: string; vector: number[] }): Promise<void> {
    await this.db
      .insert(postEmbedding)
      .values({ postId, model: e.model, contentHash: e.contentHash, embedding: e.vector })
      .onConflictDoUpdate({
        target: postEmbedding.postId,
        set: { model: e.model, contentHash: e.contentHash, embedding: e.vector, updatedAt: sql`now()` },
      });
  }

  async remove(postId: string): Promise<void> {
    await this.db.delete(postEmbedding).where(eq(postEmbedding.postId, postId));
  }

  async similarTo(postId: string, opts: { limit: number; filter: VectorFilter }): Promise<VectorHit[]> {
    if (!(await this.has(postId))) return [];
    const v = await vectorSql(this.db);
    const dist = v.cosineDistance(sql`e.embedding`, sql`(select embedding from post_embedding where post_id = ${postId}::uuid)`);
    const rows = await this.rows<{ id: string; similarity: number }>(sql`
      select p.id, 1 - ${dist} as similarity from post_embedding e
      join post p on p.id = e.post_id
      where ${this.eligible(opts.filter)} and e.post_id <> ${postId}::uuid
      order by ${dist}, p.published_at desc
      limit ${opts.limit}`);
    return rows.map((r) => ({ postId: r.id, similarity: Number(r.similarity) }));
  }

  async search(vector: number[], opts: { limit: number; minSimilarity: number; filter: VectorFilter }): Promise<VectorHit[]> {
    const v = await vectorSql(this.db);
    const dist = v.cosineDistance(sql`e.embedding`, sql`${vectorLiteral(vector)}::${v.type}`);
    const rows = await this.rows<{ id: string; similarity: number }>(sql`
      select p.id, 1 - ${dist} as similarity from post_embedding e
      join post p on p.id = e.post_id
      where ${this.eligible(opts.filter)} and 1 - ${dist} >= ${opts.minSimilarity}
      order by ${dist}
      limit ${opts.limit}`);
    return rows.map((r) => ({ postId: r.id, similarity: Number(r.similarity) }));
  }
}
