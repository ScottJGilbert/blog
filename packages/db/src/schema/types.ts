import { customType } from "drizzle-orm/pg-core";

/** Postgres `tsvector` (only ever produced by a generated column; never written by the app). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** Lexical `SerializedEditorState` JSON (validated by `@blog/content`; opaque to the DB layer). */
export type LexicalJson = { root: { type: string; children: unknown[]; [k: string]: unknown }; [k: string]: unknown };
