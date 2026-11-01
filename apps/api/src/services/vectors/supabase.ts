import { HttpError } from "../../errors";
import type { VectorFilter, VectorHit, VectorStore } from "./types";

/**
 * PLACEHOLDER for a Supabase-native vector store (`VECTOR_DRIVER=supabase`): not written yet, every call answers 501.
 *
 * Intended shape when it is: supabase-js with the service-role key (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) calling
 * `match_*` Postgres functions through PostgREST (or Supabase vector buckets), keeping the same contract as `PgVectorStore`:
 * eligibility filtering inside the store, cosine similarity out. Note Supabase's own embedding models have other dimensions
 * (gte-small = 384) than `EMBEDDING_DIMENSIONS` (1536); changing that is a schema migration.
 *
 * Until then leave `VECTOR_DRIVER` unset: `pgvector` already works on Supabase Postgres (pgvector is installed in the
 * `extensions` schema there; `@blog/db` qualifies it).
 */
export class SupabaseVectorStore implements VectorStore {
  readonly driver = "supabase";

  private fail(): never {
    throw new HttpError(501, "internal", "VECTOR_DRIVER=supabase is not implemented yet; use VECTOR_DRIVER=pgvector.");
  }

  async contentHashes(): Promise<Map<string, string>> {
    return this.fail();
  }
  async has(): Promise<boolean> {
    return this.fail();
  }
  async upsert(): Promise<void> {
    return this.fail();
  }
  async remove(): Promise<void> {
    return this.fail();
  }
  async similarTo(_postId: string, _opts: { limit: number; filter: VectorFilter }): Promise<VectorHit[]> {
    return this.fail();
  }
  async search(): Promise<VectorHit[]> {
    return this.fail();
  }
}
