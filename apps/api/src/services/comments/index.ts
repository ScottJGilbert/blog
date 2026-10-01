import { and, asc, comment, commentReport, count, desc, eq, inArray, post, sql, user, type SQL } from "@blog/db";
import { COMMENT_EDIT_WINDOW_MINUTES, type Comment, type CommentReply, type CreateCommentInput } from "@blog/shared";
import type { Deps } from "../../deps";
import { badRequest, forbidden, notFound } from "../../errors";
import { sanitizeCommentBody } from "./sanitize";

export { sanitizeCommentBody } from "./sanitize";

export interface Viewer {
  id: string;
  role: "reader" | "admin";
}

const DELETED_BODY = "[deleted]";
const DELETED_AUTHOR = "Deleted user";

interface Row {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  status: "visible" | "hidden" | "deleted";
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  createdAt: Date;
  editedAt: Date | null;
}

const cols = {
  id: comment.id,
  postId: comment.postId,
  parentId: comment.parentId,
  body: comment.body,
  status: comment.status,
  authorId: comment.authorId,
  authorName: user.name,
  authorImage: user.image,
  createdAt: comment.createdAt,
  editedAt: comment.editedAt,
};

export function createCommentsService(deps: Deps) {
  const { db } = deps;
  const windowMs = COMMENT_EDIT_WINDOW_MINUTES * 60_000;

  const withinWindow = (createdAt: Date) => deps.now().getTime() - createdAt.getTime() <= windowMs;

  function toReply(row: Row, viewer: Viewer | null): CommentReply {
    const deleted = row.status !== "visible";
    const own = viewer !== null && row.authorId !== null && row.authorId === viewer.id;
    return {
      id: row.id,
      parentId: row.parentId,
      body: deleted ? DELETED_BODY : row.body,
      status: deleted ? "deleted" : "visible",
      author: deleted || !row.authorName ? { name: DELETED_AUTHOR, image: null } : { name: row.authorName, image: row.authorImage },
      createdAt: row.createdAt.toISOString(),
      editedAt: deleted || !row.editedAt ? null : row.editedAt.toISOString(),
      canEdit: !deleted && own && withinWindow(row.createdAt),
      canDelete: !deleted && (own || viewer?.role === "admin"),
    };
  }

  const selectComments = () => db.select(cols).from(comment).leftJoin(user, eq(user.id, comment.authorId));

  /** top-level comments of a post that readers may see: visible, or deleted placeholders that still have visible replies */
  const visibleTopLevel = (postId: string): SQL =>
    sql`${comment.postId} = ${postId}::uuid and ${comment.parentId} is null and (
      ${comment.status} = 'visible'
      or (${comment.status} = 'deleted' and exists (select 1 from comment r where r.parent_id = ${comment.id} and r.status = 'visible'))
    )`;

  return {
    /** Page of top-level comments (newest first) with all visible replies (oldest first). Viewer-specific flags set. */
    async list(postId: string, page: { page: number; pageSize: number }, viewer: Viewer | null): Promise<{ items: Comment[]; total: number }> {
      const where = visibleTopLevel(postId);
      const [tops, totals] = await Promise.all([
        selectComments()
          .where(where)
          .orderBy(desc(comment.createdAt), desc(comment.id))
          .limit(page.pageSize)
          .offset((page.page - 1) * page.pageSize),
        db.select({ n: count() }).from(comment).where(where),
      ]);
      const replies = tops.length
        ? await selectComments()
            .where(and(inArray(comment.parentId, tops.map((t) => t.id)), eq(comment.status, "visible")))
            .orderBy(asc(comment.createdAt), asc(comment.id))
        : [];
      const byParent = new Map<string, CommentReply[]>();
      for (const r of replies) {
        const list = byParent.get(r.parentId!) ?? [];
        list.push(toReply(r, viewer));
        byParent.set(r.parentId!, list);
      }
      return {
        items: tops.map((t) => ({ ...toReply(t, viewer), replies: byParent.get(t.id) ?? [] })),
        total: totals[0]?.n ?? 0,
      };
    },

    async create(postId: string, author: Viewer, input: CreateCommentInput): Promise<Comment> {
      const body = sanitizeCommentBody(input.body);
      if (body.length === 0) throw badRequest("Comment cannot be empty");
      if (body.length > 4000) throw badRequest("Comment is too long (max 4000 characters)");

      let parentId: string | null = null;
      if (input.parentId) {
        const [parent] = await db.select({ id: comment.id, postId: comment.postId, parentId: comment.parentId, status: comment.status }).from(comment).where(eq(comment.id, input.parentId)).limit(1);
        if (!parent || parent.postId !== postId || parent.status !== "visible") throw notFound("The comment you are replying to does not exist");
        // max depth 1: replies to replies attach to the top-level parent
        parentId = parent.parentId ?? parent.id;
        if (parent.parentId) {
          const [top] = await db.select({ status: comment.status }).from(comment).where(eq(comment.id, parent.parentId)).limit(1);
          if (!top || top.status === "hidden") throw notFound("The comment you are replying to does not exist");
        }
      }

      const [created] = await db
        .insert(comment)
        .values({ postId, authorId: author.id, parentId, body, createdAt: deps.now() })
        .returning({ id: comment.id });
      const [row] = await selectComments().where(eq(comment.id, created!.id)).limit(1);
      return { ...toReply(row!, author), replies: [] };
    },

    /** Author edits own visible comment within the edit window. */
    async update(id: string, actor: Viewer, bodyInput: string): Promise<CommentReply> {
      const body = sanitizeCommentBody(bodyInput);
      if (body.length === 0) throw badRequest("Comment cannot be empty");
      if (body.length > 4000) throw badRequest("Comment is too long (max 4000 characters)");
      const [row] = await selectComments().where(eq(comment.id, id)).limit(1);
      if (!row || row.status !== "visible") throw notFound("Comment not found");
      if (row.authorId !== actor.id) throw forbidden("You can only edit your own comments");
      if (!withinWindow(row.createdAt)) throw forbidden(`Comments can only be edited within ${COMMENT_EDIT_WINDOW_MINUTES} minutes of posting`);
      const editedAt = deps.now();
      // conditional on `visible`: a moderator hiding / deleting the comment between the read and this write must win
      const updated = await db.update(comment).set({ body, editedAt }).where(and(eq(comment.id, id), eq(comment.status, "visible"))).returning({ id: comment.id });
      if (updated.length === 0) throw notFound("Comment not found");
      return toReply({ ...row, body, editedAt }, actor);
    },

    /** Soft delete by the author or an admin. Returns the comment's post id for the audit trail; idempotent. */
    async remove(id: string, actor: Viewer): Promise<{ postId: string; byAdmin: boolean }> {
      const [row] = await db.select({ id: comment.id, postId: comment.postId, authorId: comment.authorId, status: comment.status }).from(comment).where(eq(comment.id, id)).limit(1);
      if (!row) throw notFound("Comment not found");
      const own = row.authorId === actor.id;
      if (!own && actor.role !== "admin") {
        // do not reveal that comments exist that the viewer cannot see
        if (row.status !== "visible") throw notFound("Comment not found");
        throw forbidden("You can only delete your own comments");
      }
      if (own && actor.role !== "admin" && row.status === "hidden") throw notFound("Comment not found");
      if (row.status !== "deleted") await db.update(comment).set({ status: "deleted" }).where(eq(comment.id, id));
      return { postId: row.postId, byAdmin: !own };
    },

    /** Report a visible comment (once per reporter). */
    async report(id: string, reporter: Viewer, reason: string): Promise<void> {
      const [row] = await db.select({ id: comment.id, authorId: comment.authorId, status: comment.status }).from(comment).where(eq(comment.id, id)).limit(1);
      if (!row || row.status !== "visible") throw notFound("Comment not found");
      if (row.authorId === reporter.id) throw badRequest("You cannot report your own comment");
      await db
        .insert(commentReport)
        .values({ commentId: id, reporterId: reporter.id, reason, createdAt: deps.now() })
        .onConflictDoNothing({ target: [commentReport.commentId, commentReport.reporterId] });
    },

    /** Slug → post id for published posts only (comments are not served for drafts). */
    async postIdForSlug(slug: string): Promise<string | null> {
      const [row] = await db
        .select({ id: post.id })
        .from(post)
        .where(and(eq(post.slug, slug), sql`${post.status} = 'published' and ${post.publishedAt} <= ${deps.now().toISOString()}::timestamptz`))
        .limit(1);
      return row?.id ?? null;
    },
  };
}

export type CommentsService = ReturnType<typeof createCommentsService>;
