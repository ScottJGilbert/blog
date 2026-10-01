import { z } from "zod";
import {
  COMMENT_MAX_LENGTH,
  CommentStatusSchema,
  IsoDateSchema,
  PaginationQuerySchema,
  REPORT_REASON_MAX,
  REPORT_REASON_MIN,
  SectionSchema,
  UuidSchema,
} from "./common";
import { AuthorRefSchema } from "./posts";

const CommentBodySchema = z.string().trim().min(1).max(COMMENT_MAX_LENGTH);

/** A reply (no nesting). Deleted comments that still have replies come back with `body: "[deleted]"`. */
export const CommentReplySchema = z.object({
  id: UuidSchema,
  parentId: UuidSchema.nullable(),
  body: z.string(),
  status: z.enum(["visible", "deleted"]),
  author: AuthorRefSchema,
  createdAt: IsoDateSchema,
  editedAt: IsoDateSchema.nullable(),
  /** true when the viewer is the author and still inside the edit window */
  canEdit: z.boolean(),
  /** true when the viewer may delete it (author or admin) */
  canDelete: z.boolean(),
});

export const CommentSchema = CommentReplySchema.extend({
  /** oldest first */
  replies: z.array(CommentReplySchema),
});

export const ListCommentsQuerySchema = PaginationQuerySchema;

export const CreateCommentInputSchema = z.object({
  body: CommentBodySchema,
  parentId: UuidSchema.optional(),
});
export const UpdateCommentInputSchema = z.object({ body: CommentBodySchema });
export const ReportCommentInputSchema = z.object({
  reason: z.string().trim().min(REPORT_REASON_MIN).max(REPORT_REASON_MAX),
});

// ----- admin ---------------------------------------------------------------------------------------------------------
export const CommentReportSchema = z.object({
  id: UuidSchema,
  reporter: z.object({ id: z.string(), name: z.string() }),
  reason: z.string(),
  createdAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.nullable(),
});

export const AdminCommentSchema = z.object({
  id: UuidSchema,
  parentId: UuidSchema.nullable(),
  body: z.string(),
  status: CommentStatusSchema,
  author: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  post: z.object({ id: UuidSchema, slug: z.string(), title: z.string(), section: SectionSchema }),
  reports: z.array(CommentReportSchema),
  openReportCount: z.number().int().min(0),
  createdAt: IsoDateSchema,
  editedAt: IsoDateSchema.nullable(),
});

export const AdminListCommentsQuerySchema = PaginationQuerySchema.extend({
  status: CommentStatusSchema.optional(),
  /** `true` → only comments with unresolved reports */
  reported: z.stringbool().optional(),
});

export const UpdateCommentStatusInputSchema = z.object({ status: CommentStatusSchema });

export type CommentReply = z.infer<typeof CommentReplySchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type ListCommentsQuery = z.output<typeof ListCommentsQuerySchema>;
export type ListCommentsQueryInput = z.input<typeof ListCommentsQuerySchema>;
export type CreateCommentInput = z.output<typeof CreateCommentInputSchema>;
export type CreateCommentInputInput = z.input<typeof CreateCommentInputSchema>;
export type UpdateCommentInput = z.infer<typeof UpdateCommentInputSchema>;
export type ReportCommentInput = z.infer<typeof ReportCommentInputSchema>;
export type CommentReport = z.infer<typeof CommentReportSchema>;
export type AdminComment = z.infer<typeof AdminCommentSchema>;
export type AdminListCommentsQuery = z.output<typeof AdminListCommentsQuerySchema>;
export type AdminListCommentsQueryInput = z.input<typeof AdminListCommentsQuerySchema>;
export type UpdateCommentStatusInput = z.infer<typeof UpdateCommentStatusInputSchema>;
