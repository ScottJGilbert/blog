import { z } from "zod";
import {
  IsoDateSchema,
  LexicalContentSchema,
  PaginationQuerySchema,
  PostStatusSchema,
  SectionSchema,
  SlugSchema,
  UrlOrPathSchema,
  UuidSchema,
} from "./common";

export const TagRefSchema = z.object({ slug: z.string(), name: z.string() });
export const TagWithCountSchema = TagRefSchema.extend({ count: z.number().int().min(0) });
export const AuthorRefSchema = z.object({ name: z.string(), image: z.string().nullable() });

export const PostSummarySchema = z.object({
  id: UuidSchema,
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  section: SectionSchema,
  tags: z.array(TagRefSchema),
  coverImageUrl: z.string().nullable(),
  coverImageAlt: z.string().nullable(),
  author: AuthorRefSchema,
  publishedAt: IsoDateSchema,
  readingMinutes: z.number().int().min(1),
});

export const PostNavRefSchema = z.object({ slug: z.string(), title: z.string(), section: SectionSchema });
export const TocItemSchema = z.object({ id: z.string(), text: z.string(), level: z.number().int().min(1).max(6) });

export const PostDetailSchema = PostSummarySchema.extend({
  content: LexicalContentSchema,
  contentHtml: z.string(),
  toc: z.array(TocItemSchema),
  updatedAt: IsoDateSchema,
  prev: PostNavRefSchema.nullable(),
  next: PostNavRefSchema.nullable(),
});

export const SearchResultSchema = PostSummarySchema.extend({
  /** `ts_headline` output; only `<mark>` tags are ever present, everything else is HTML-escaped. */
  snippet: z.string(),
  score: z.number(),
});

export const SitemapEntrySchema = z.object({ section: SectionSchema, slug: z.string(), updatedAt: IsoDateSchema });

export const HealthSchema = z.object({
  status: z.literal("ok"),
  db: z.enum(["up", "down"]),
  version: z.string(),
});

// ----- queries -------------------------------------------------------------------------------------------------------
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const PostSortSchema = z.enum(["newest", "oldest"]);

export const ListPostsQuerySchema = PaginationQuerySchema.extend({
  section: SectionSchema.optional(),
  /** tag slug */
  tag: optionalText(100),
  q: optionalText(200),
  sort: PostSortSchema.default("newest"),
});

export const RelatedPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(3),
});

export const SearchQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(2).max(200),
  section: SectionSchema.optional(),
});

export const FeedQuerySchema = z.object({ section: SectionSchema.optional() });

// ----- admin ---------------------------------------------------------------------------------------------------------
export const AdminPostSummarySchema = z.object({
  id: UuidSchema,
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  section: SectionSchema,
  status: PostStatusSchema,
  tags: z.array(TagRefSchema),
  coverImageUrl: z.string().nullable(),
  author: AuthorRefSchema.extend({ id: z.string() }),
  publishedAt: IsoDateSchema.nullable(),
  scheduledFor: IsoDateSchema.nullable(),
  readingMinutes: z.number().int().min(1),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export const AdminPostDetailSchema = AdminPostSummarySchema.extend({
  content: LexicalContentSchema,
  coverImageAlt: z.string().nullable(),
  hasEmbedding: z.boolean(),
});

export const AdminListPostsQuerySchema = PaginationQuerySchema.extend({
  status: PostStatusSchema.optional(),
  section: SectionSchema.optional(),
  q: optionalText(200),
});

const TagNamesSchema = z.array(z.string().trim().min(1).max(40)).max(12);

const PostInputShape = z.object({
  title: z.string().trim().min(1).max(200),
  slug: SlugSchema.optional(),
  excerpt: z.string().trim().max(500).optional(),
  section: SectionSchema,
  /** tag names; server slugifies and upserts */
  tags: TagNamesSchema,
  content: LexicalContentSchema,
  coverImageUrl: UrlOrPathSchema.nullable().optional(),
  coverImageAlt: z.string().trim().max(300).nullable().optional(),
  status: PostStatusSchema.optional(),
});

export const CreatePostInputSchema = PostInputShape.extend({ tags: TagNamesSchema.default([]) });
/** All fields optional; omitted fields are left unchanged (no defaults are applied). */
export const UpdatePostInputSchema = PostInputShape.partial();

export const SchedulePostInputSchema = z.object({ scheduledFor: IsoDateSchema });

export type TagRef = z.infer<typeof TagRefSchema>;
export type TagWithCount = z.infer<typeof TagWithCountSchema>;
export type AuthorRef = z.infer<typeof AuthorRefSchema>;
export type PostSummary = z.infer<typeof PostSummarySchema>;
export type PostNavRef = z.infer<typeof PostNavRefSchema>;
export type TocItem = z.infer<typeof TocItemSchema>;
export type PostDetail = z.infer<typeof PostDetailSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SitemapEntry = z.infer<typeof SitemapEntrySchema>;
export type Health = z.infer<typeof HealthSchema>;
export type PostSort = z.infer<typeof PostSortSchema>;
export type ListPostsQuery = z.output<typeof ListPostsQuerySchema>;
export type ListPostsQueryInput = z.input<typeof ListPostsQuerySchema>;
export type RelatedPostsQuery = z.output<typeof RelatedPostsQuerySchema>;
export type RelatedPostsQueryInput = z.input<typeof RelatedPostsQuerySchema>;
export type SearchQuery = z.output<typeof SearchQuerySchema>;
export type SearchQueryInput = z.input<typeof SearchQuerySchema>;
export type AdminPostSummary = z.infer<typeof AdminPostSummarySchema>;
export type AdminPostDetail = z.infer<typeof AdminPostDetailSchema>;
export type AdminListPostsQuery = z.output<typeof AdminListPostsQuerySchema>;
export type AdminListPostsQueryInput = z.input<typeof AdminListPostsQuerySchema>;
export type CreatePostInput = z.output<typeof CreatePostInputSchema>;
export type CreatePostInputInput = z.input<typeof CreatePostInputSchema>;
export type UpdatePostInput = z.output<typeof UpdatePostInputSchema>;
export type UpdatePostInputInput = z.input<typeof UpdatePostInputSchema>;
export type SchedulePostInput = z.infer<typeof SchedulePostInputSchema>;
