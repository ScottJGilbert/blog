import type { Database } from "@blog/db";
import type { Config } from "../../config";
import { PgVectorStore } from "./pgvector";
import { SupabaseVectorStore } from "./supabase";
import type { VectorStore } from "./types";

export * from "./types";
export { PgVectorStore } from "./pgvector";
export { SupabaseVectorStore } from "./supabase";

/** `VECTOR_DRIVER=pgvector|supabase` (default `pgvector`, which works on any Postgres with the extension, Supabase included). */
export function createVectorStore(config: Config, db: Database): VectorStore {
  return config.vectors.driver === "supabase" ? new SupabaseVectorStore() : new PgVectorStore(db);
}
