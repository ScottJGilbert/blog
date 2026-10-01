import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { post } from "./posts";
import type { LexicalJson } from "./types";

export const SUBSCRIBER_STATUSES = ["pending", "confirmed", "unsubscribed"] as const;
export const NEWSLETTER_STATUSES = ["draft", "scheduled", "sending", "sent", "failed"] as const;
export const subscriberStatus = pgEnum("subscriber_status", SUBSCRIBER_STATUSES);
export const newsletterStatus = pgEnum("newsletter_status", NEWSLETTER_STATUSES);
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];

export const subscriber = pgTable(
  "subscriber",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Always stored lowercased (enforced by check constraint). */
    email: text("email").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    status: subscriberStatus("status").notNull().default("pending"),
    confirmToken: text("confirm_token").unique(),
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
    listmonkSubscriberId: integer("listmonk_subscriber_id"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [
    index("subscriber_status_idx").on(t.status),
    index("subscriber_user_idx").on(t.userId),
    check("subscriber_email_lowercase", sql`${t.email} = lower(${t.email})`),
  ],
);

export type NewsletterStats = {
  sent?: number;
  views?: number;
  clicks?: number;
  bounces?: number;
  toSend?: number;
  [k: string]: unknown;
};

export const newsletter = pgTable(
  "newsletter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    preheader: text("preheader"),
    postId: uuid("post_id").references(() => post.id, { onDelete: "set null" }),
    content: jsonb("content").$type<LexicalJson>(),
    /** Rendered snapshot (email target) taken at preview/send time. */
    html: text("html").notNull().default(""),
    status: newsletterStatus("status").notNull().default("draft"),
    listmonkCampaignId: integer("listmonk_campaign_id"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    stats: jsonb("stats").$type<NewsletterStats>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("newsletter_status_idx").on(t.status, t.scheduledFor),
    index("newsletter_post_idx").on(t.postId),
    check("newsletter_scheduled_has_date", sql`${t.status} <> 'scheduled' OR ${t.scheduledFor} IS NOT NULL`),
  ],
);
