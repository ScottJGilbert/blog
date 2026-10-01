import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { tsvector, type LexicalJson } from "./types";

export const POST_SECTIONS = ["personal", "engineering"] as const;
export const POST_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export const postSection = pgEnum("post_section", POST_SECTIONS);
export const postStatus = pgEnum("post_status", POST_STATUSES);
export type PostSection = (typeof POST_SECTIONS)[number];
export type PostStatus = (typeof POST_STATUSES)[number];

export const EMBEDDING_DIMENSIONS = 1536;

export const post = pgTable(
  "post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    section: postSection("section").notNull(),
    status: postStatus("status").notNull().default("draft"),
    content: jsonb("content").$type<LexicalJson>().notNull(),
    /** Plain text derived from `content` by `@blog/content` (`toPlainText`). */
    contentText: text("content_text").notNull().default(""),
    /** Generated: title (A) + excerpt (B) + content_text (C). Never write to this column. */
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') || setweight(to_tsvector('english', coalesce(content_text, '')), 'C')`,
      ),
    coverImageUrl: text("cover_image_url"),
    coverImageAlt: text("cover_image_alt"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    readingMinutes: integer("reading_minutes").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("post_search_idx").using("gin", t.searchVector),
    // listing: published posts per section, newest first
    index("post_listing_idx").on(t.status, t.section, t.publishedAt.desc()),
    index("post_author_idx").on(t.authorId),
    index("post_scheduled_idx").on(t.scheduledFor).where(sql`${t.status} = 'scheduled'`),
    check("post_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("post_reading_minutes_positive", sql`${t.readingMinutes} >= 1`),
    check("post_published_has_date", sql`${t.status} <> 'published' OR ${t.publishedAt} IS NOT NULL`),
    check("post_scheduled_has_date", sql`${t.status} <> 'scheduled' OR ${t.scheduledFor} IS NOT NULL`),
  ],
);

export const tag = pgTable(
  "tag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
  },
  (t) => [check("tag_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)],
);

export const postTag = pgTable(
  "post_tag",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index("post_tag_tag_idx").on(t.tagId)],
);

export const postEmbedding = pgTable(
  "post_embedding",
  {
    postId: uuid("post_id")
      .primaryKey()
      .references(() => post.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("post_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

