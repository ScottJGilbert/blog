import { z } from "zod";
import { CommentStatusSchema, IsoDateSchema, PostStatusSchema, SectionSchema, UuidSchema } from "./common";

const count = z.number().int().min(0);

export const StatsSchema = z.object({
  posts: z.object({ published: count, draft: count, scheduled: count }),
  comments: z.object({ total: count, reported: count }),
  users: z.object({ total: count, admins: count }),
  subscribers: z.object({ confirmed: count, pending: count }),
  recentPosts: z.array(
    z.object({
      id: UuidSchema,
      slug: z.string(),
      title: z.string(),
      section: SectionSchema,
      status: PostStatusSchema,
      updatedAt: IsoDateSchema,
    }),
  ),
  recentComments: z.array(
    z.object({
      id: UuidSchema,
      body: z.string(),
      status: CommentStatusSchema,
      authorName: z.string(),
      postSlug: z.string(),
      postTitle: z.string(),
      createdAt: IsoDateSchema,
    }),
  ),
});

export const ReindexResultSchema = z.object({
  /** false when EMBEDDING_API_KEY is unset */
  enabled: z.boolean(),
  /** posts queued for re-embedding */
  queued: count,
});

/** `GET /api/admin/system` — read-only environment health (admin settings page). Added by WP B2. */
export const SystemInfoSchema = z.object({
  db: z.enum(["up", "down"]),
  /** mailer driver in use: console | smtp | resend | memory */
  mailer: z.string(),
  /** storage driver in use: local | vercel-blob | memory */
  storage: z.string(),
  embeddings: z.object({ enabled: z.boolean(), model: z.string() }),
  newsletter: z.object({ provider: z.enum(["listmonk", "noop"]), configured: z.boolean() }),
  version: z.string(),
});

export type Stats = z.infer<typeof StatsSchema>;
export type ReindexResult = z.infer<typeof ReindexResultSchema>;
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
