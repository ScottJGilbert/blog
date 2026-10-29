import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "./client";

/**
 * pgvector lives in `public` on plain Postgres but in the `extensions` schema on Supabase, and a pooled connection cannot
 * `SET search_path`. So queries never rely on the search_path to find the `vector` type or the `<=>` operator: they look up the
 * extension's schema once per database handle and schema-qualify both.
 */
const cache = new WeakMap<object, Promise<string>>();

/** Schema pgvector is installed in (`public` when it is not installed: the query then fails the way it always did). */
export function vectorSchema(db: DbOrTx): Promise<string> {
  let found = cache.get(db);
  if (!found) {
    found = db
      .execute<{ nspname: string }>(sql`select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`)
      .then((r) => r.rows[0]?.nspname ?? "public");
    cache.set(db, found);
    found.catch(() => cache.delete(db)); // do not cache a failed lookup
  }
  return found;
}

export interface VectorSql {
  /** The (schema-qualified) `vector` type, for `${param}::${type}` casts. */
  type: SQL;
  /** Cosine distance `a <=> b` with the operator schema-qualified. */
  cosineDistance(a: SQL, b: SQL): SQL;
}

export async function vectorSql(db: DbOrTx): Promise<VectorSql> {
  const schema = sql.identifier(await vectorSchema(db));
  return {
    type: sql`${schema}.vector`,
    cosineDistance: (a, b) => sql`(${a} OPERATOR(${schema}.<=>) ${b})`,
  };
}
