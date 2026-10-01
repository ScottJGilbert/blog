import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Storage key (random, unguessable). */
    key: text("key").notNull().unique(),
    url: text("url").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("media_created_idx").on(t.createdAt.desc()),
    check("media_size_nonneg", sql`${t.sizeBytes} >= 0`),
  ],
);

export const API_KEY_SCOPES = ["posts:read", "comments:read", "tags:read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** First 8 chars of the key, shown in the UI. */
    prefix: text("prefix").notNull(),
    /** sha256 hex of the full key. The key itself is shown once and never stored. */
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().$type<ApiKeyScope[]>().notNull().default(sql`ARRAY[]::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("api_key_scopes_valid", sql`${t.scopes} <@ ARRAY['posts:read', 'comments:read', 'tags:read']::text[]`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt.desc()),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_actor_idx").on(t.actorId),
  ],
);

