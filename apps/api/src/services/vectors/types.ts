import type { Section } from "@blog/shared";

/**
 * Where post embeddings are stored and searched. The rest of the API only talks to this interface (`deps.vectors`), so the
 * backing store can be swapped per environment with `VECTOR_DRIVER` (plain Postgres + pgvector for docker compose,
 * Supabase for the serverless deployment) without touching the posts service.
 *
 * Embedding *generation* is a separate concern (`deps.embeddings`); a store only persists and queries vectors.
 */
export interface VectorHit {
  postId: string;
  /** Cosine similarity, 1 = identical direction. */
  similarity: number;
}

/** Which posts a query may return. Stores apply it themselves so `limit` is filled with eligible posts only. */
export interface VectorFilter {
  /** Only posts a reader can see at this instant (published and `published_at <= now`). */
  publishedAt: Date;
  section?: Section;
}

export interface VectorStore {
  readonly driver: "pgvector" | "supabase";
  /** Content hash stored with each post's vector (posts without a vector are absent from the map). */
  contentHashes(postIds: string[]): Promise<Map<string, string>>;
  has(postId: string): Promise<boolean>;
  /** Insert or replace the vector of a post. */
  upsert(postId: string, entry: { model: string; contentHash: string; vector: number[] }): Promise<void>;
  /** Drop the vector of a post (missing is not an error). The pgvector driver also gets this from `ON DELETE CASCADE`. */
  remove(postId: string): Promise<void>;
  /** Posts most similar to a stored post, best first, never the post itself. `[]` when the post has no vector. */
  similarTo(postId: string, opts: { limit: number; filter: VectorFilter }): Promise<VectorHit[]>;
  /** Posts most similar to a query vector, best first, dropping hits below `minSimilarity`. */
  search(vector: number[], opts: { limit: number; minSimilarity: number; filter: VectorFilter }): Promise<VectorHit[]>;
}
