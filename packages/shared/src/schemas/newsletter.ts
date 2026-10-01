import { z } from "zod";
import {
  EmailSchema,
  IsoDateSchema,
  LexicalContentSchema,
  NewsletterStatusSchema,
  PaginationQuerySchema,
  SubscriberStatusSchema,
  UuidSchema,
} from "./common";

const TokenSchema = z.string().trim().min(8).max(256);

// ----- public --------------------------------------------------------------------------------------------------------
export const SubscribeInputSchema = z.object({
  email: EmailSchema,
  source: z.string().trim().min(1).max(64).optional(),
});
export const ConfirmSubscriptionInputSchema = z.object({ token: TokenSchema });
export const UnsubscribeInputSchema = z.object({ token: TokenSchema });
export const UnsubscribeQuerySchema = z.object({ token: TokenSchema });

export const SubscriptionSchema = z.object({ status: SubscriberStatusSchema });
export const ConfirmSubscriptionResultSchema = z.object({ status: z.literal("confirmed") });
export const UnsubscribeResultSchema = z.object({ status: z.literal("unsubscribed") });
export const SetSubscriptionInputSchema = z.object({ subscribed: z.boolean() });

// ----- admin ---------------------------------------------------------------------------------------------------------
export const SubscriberSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  userId: z.string().nullable(),
  status: SubscriberStatusSchema,
  source: z.string().nullable(),
  listmonkSubscriberId: z.number().int().nullable(),
  createdAt: IsoDateSchema,
  confirmedAt: IsoDateSchema.nullable(),
  unsubscribedAt: IsoDateSchema.nullable(),
});

export const ListSubscribersQuerySchema = PaginationQuerySchema.extend({
  status: SubscriberStatusSchema.optional(),
  q: z.string().trim().max(200).optional(),
});

export const SubscriberSyncResultSchema = z.object({
  /** false when no newsletter provider (listmonk) is configured */
  providerConfigured: z.boolean(),
  synced: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export const NewsletterStatsSchema = z.looseObject({
  sent: z.number().optional(),
  toSend: z.number().optional(),
  views: z.number().optional(),
  clicks: z.number().optional(),
  bounces: z.number().optional(),
});

export const NewsletterSummarySchema = z.object({
  id: UuidSchema,
  subject: z.string(),
  preheader: z.string().nullable(),
  postId: UuidSchema.nullable(),
  status: NewsletterStatusSchema,
  listmonkCampaignId: z.number().int().nullable(),
  scheduledFor: IsoDateSchema.nullable(),
  sentAt: IsoDateSchema.nullable(),
  stats: NewsletterStatsSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export const NewsletterSchema = NewsletterSummarySchema.extend({
  content: LexicalContentSchema.nullable(),
  /** rendered snapshot (email target) */
  html: z.string(),
});

export const ListNewslettersQuerySchema = PaginationQuerySchema.extend({
  status: NewsletterStatusSchema.optional(),
});

export const CreateNewsletterInputSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  preheader: z.string().trim().max(300).nullable().optional(),
  /** create pre-filled from this post */
  postId: UuidSchema.nullable().optional(),
  content: LexicalContentSchema.nullable().optional(),
});
export const UpdateNewsletterInputSchema = CreateNewsletterInputSchema.omit({ postId: true }).partial().extend({
  postId: UuidSchema.nullable().optional(),
});
export const NewsletterPreviewSchema = z.object({ html: z.string() });
export const TestNewsletterInputSchema = z.object({ email: EmailSchema });
export const ScheduleNewsletterInputSchema = z.object({ scheduledFor: IsoDateSchema });
export const SendNewsletterResultSchema = z.object({
  newsletter: NewsletterSchema,
  /** which provider handled it; `noop` = nothing was actually delivered */
  provider: z.enum(["listmonk", "noop"]),
  /** admin-facing warning, e.g. "listmonk is not configured; nothing was sent" */
  warning: z.string().nullable(),
});

export type SubscribeInput = z.output<typeof SubscribeInputSchema>;
export type SubscribeInputInput = z.input<typeof SubscribeInputSchema>;
export type ConfirmSubscriptionInput = z.infer<typeof ConfirmSubscriptionInputSchema>;
export type UnsubscribeInput = z.infer<typeof UnsubscribeInputSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type ConfirmSubscriptionResult = z.infer<typeof ConfirmSubscriptionResultSchema>;
export type UnsubscribeResult = z.infer<typeof UnsubscribeResultSchema>;
export type SetSubscriptionInput = z.infer<typeof SetSubscriptionInputSchema>;
export type Subscriber = z.infer<typeof SubscriberSchema>;
export type ListSubscribersQuery = z.output<typeof ListSubscribersQuerySchema>;
export type ListSubscribersQueryInput = z.input<typeof ListSubscribersQuerySchema>;
export type SubscriberSyncResult = z.infer<typeof SubscriberSyncResultSchema>;
export type NewsletterStats = z.infer<typeof NewsletterStatsSchema>;
export type NewsletterSummary = z.infer<typeof NewsletterSummarySchema>;
export type Newsletter = z.infer<typeof NewsletterSchema>;
export type ListNewslettersQuery = z.output<typeof ListNewslettersQuerySchema>;
export type ListNewslettersQueryInput = z.input<typeof ListNewslettersQuerySchema>;
export type CreateNewsletterInput = z.output<typeof CreateNewsletterInputSchema>;
export type CreateNewsletterInputInput = z.input<typeof CreateNewsletterInputSchema>;
export type UpdateNewsletterInput = z.output<typeof UpdateNewsletterInputSchema>;
export type UpdateNewsletterInputInput = z.input<typeof UpdateNewsletterInputSchema>;
export type NewsletterPreview = z.infer<typeof NewsletterPreviewSchema>;
export type TestNewsletterInput = z.infer<typeof TestNewsletterInputSchema>;
export type ScheduleNewsletterInput = z.infer<typeof ScheduleNewsletterInputSchema>;
export type SendNewsletterResult = z.infer<typeof SendNewsletterResultSchema>;
