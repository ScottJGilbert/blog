import { z } from "zod";
import { IsoDateSchema, PaginationQuerySchema, UuidSchema } from "./common";
import { AuthorRefSchema } from "./posts";

/** `GET /api/v1/comments?postSlug=` — public, viewer-independent shape (no canEdit/canDelete). */
export const V1CommentReplySchema = z.object({
  id: UuidSchema,
  parentId: UuidSchema.nullable(),
  body: z.string(),
  author: AuthorRefSchema,
  createdAt: IsoDateSchema,
  editedAt: IsoDateSchema.nullable(),
});
export const V1CommentSchema = V1CommentReplySchema.extend({ replies: z.array(V1CommentReplySchema) });
export const V1ListCommentsQuerySchema = PaginationQuerySchema.extend({
  postSlug: z.string().trim().min(1).max(200),
});

export type V1CommentReply = z.infer<typeof V1CommentReplySchema>;
export type V1Comment = z.infer<typeof V1CommentSchema>;
export type V1ListCommentsQuery = z.output<typeof V1ListCommentsQuerySchema>;
export type V1ListCommentsQueryInput = z.input<typeof V1ListCommentsQuerySchema>;
