import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------------
// Constants shared by API validation and UIs
// ---------------------------------------------------------------------------------------------------------------------
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;
export const COMMENT_MAX_LENGTH = 4000;
export const COMMENT_EDIT_WINDOW_MINUTES = 15;
export const REPORT_REASON_MIN = 3;
export const REPORT_REASON_MAX = 500;
export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;

export const SECTIONS = ["personal", "engineering"] as const;
export const POST_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export const COMMENT_STATUSES = ["visible", "hidden", "deleted"] as const;
export const SUBSCRIBER_STATUSES = ["pending", "confirmed", "unsubscribed"] as const;
export const NEWSLETTER_STATUSES = ["draft", "scheduled", "sending", "sent", "failed"] as const;
export const USER_ROLES = ["reader", "admin"] as const;
export const API_KEY_SCOPES = ["posts:read", "comments:read", "tags:read"] as const;
export const ERROR_CODES = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal",
] as const;

export const SectionSchema = z.enum(SECTIONS);
export const PostStatusSchema = z.enum(POST_STATUSES);
export const CommentStatusSchema = z.enum(COMMENT_STATUSES);
export const SubscriberStatusSchema = z.enum(SUBSCRIBER_STATUSES);
export const NewsletterStatusSchema = z.enum(NEWSLETTER_STATUSES);
export const UserRoleSchema = z.enum(USER_ROLES);
export const ApiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export const ErrorCodeSchema = z.enum(ERROR_CODES);

export type Section = z.infer<typeof SectionSchema>;
export type PostStatus = z.infer<typeof PostStatusSchema>;
export type CommentStatus = z.infer<typeof CommentStatusSchema>;
export type SubscriberStatus = z.infer<typeof SubscriberStatusSchema>;
export type NewsletterStatus = z.infer<typeof NewsletterStatusSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------------------------------
/** ISO-8601 timestamp string (what `Date#toISOString()` produces; offsets accepted on input). */
export const IsoDateSchema = z.iso.datetime({ offset: true });
export const UuidSchema = z.uuid();
export const SlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens only");
/** Absolute http(s) URL or a site-relative path (`/api/media/files/…`). */
export const UrlOrPathSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    // Browsers drop tab/newline anywhere in a URL and treat `\` like `/`: `/\evil.com`, `/\t/evil.com` would become
    // protocol-relative `//evil.com`. Control characters and backslashes never belong in a stored URL.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F-\u009F\\]/.test(v)) return false;
    if (v.startsWith("/") && !v.startsWith("//")) return true;
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an http(s) URL or a site-relative path");
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Lexical `SerializedEditorState` (opaque here; deep validation lives in `@blog/content`). */
export const LexicalContentSchema = z.looseObject({
  root: z.looseObject({
    type: z.literal("root"),
    children: z.array(z.unknown()),
  }),
});
export type LexicalContent = z.infer<typeof LexicalContentSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------------------------------------------------
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.output<typeof PaginationQuerySchema>;
export type PaginationQueryInput = z.input<typeof PaginationQuerySchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export function paginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------------------------------------
export const ErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export const ErrorEnvelopeSchema = z.object({ error: ErrorBodySchema });
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** `{ data: T, meta? }` */
export function envelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: PaginationMetaSchema.optional() });
}
/** `{ data: T[], meta }` */
export function listEnvelope<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: PaginationMetaSchema });
}
export type Paginated<T> = { data: T[]; meta: PaginationMeta };

export const OkSchema = z.object({ ok: z.literal(true) });
