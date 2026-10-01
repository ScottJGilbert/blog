import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { post } from "./posts";

export const COMMENT_STATUSES = ["visible", "hidden", "deleted"] as const;
export const commentStatus = pgEnum("comment_status", COMMENT_STATUSES);
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const MAX_COMMENT_LENGTH = 4000;

/**
 * Comments, max depth 1: a reply's parent must be a top-level comment on the same post.
 * Enforced by trigger `comment_enforce_depth` (see migration 0001_comment_integrity.sql); the API additionally
 * re-parents replies-to-replies onto the top-level parent.
 */
export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    /** Nullable so accounts can be deleted/anonymised without losing the thread. */
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comment.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: commentStatus("status").notNull().default("visible"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [
    index("comment_post_idx").on(t.postId, t.createdAt.desc()),
    index("comment_parent_idx").on(t.parentId),
    index("comment_author_idx").on(t.authorId),
    index("comment_status_idx").on(t.status),
    check("comment_body_length", sql`char_length(${t.body}) between 1 and ${sql.raw(String(MAX_COMMENT_LENGTH))}`),
    check("comment_not_own_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

export const commentReport = pgTable(
  "comment_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("comment_report_unique").on(t.commentId, t.reporterId),
    index("comment_report_open_idx").on(t.commentId).where(sql`${t.resolvedAt} IS NULL`),
    check("comment_report_reason_length", sql`char_length(${t.reason}) between 3 and 500`),
  ],
);

