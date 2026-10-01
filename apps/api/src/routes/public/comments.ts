import { CreateCommentInputSchema, ListCommentsQuerySchema, ReportCommentInputSchema, UpdateCommentInputSchema, UuidSchema } from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { notFound } from "../../errors";
import { audit } from "../../lib/audit";
import { ok, paginated } from "../../lib/pagination";
import { parseBody, parseQuery } from "../../lib/validate";
import { optionalUser, requireUser, requireVerifiedUser } from "../../middleware/auth";
import type { CommentsService } from "../../services/comments";
import { noStore } from "./cache";

/** A malformed id can never exist: 404 instead of a database cast error. */
function commentId(raw: unknown): string {
  const parsed = UuidSchema.safeParse(raw);
  if (!parsed.success) throw notFound("Comment not found");
  return parsed.data;
}

const viewerOf = (u: Express.SessionUser | undefined) => (u ? { id: u.id, role: u.role } : null);

/** Comments (SPEC §5.3). Everything here depends on the viewer's cookie, so nothing is cacheable. */
export function commentsRouter(deps: Deps, comments: CommentsService): Router {
  const router = Router();

  router.get("/posts/:slug/comments", deps.limiters.publicRead, optionalUser, async (req, res) => {
    const page = parseQuery(ListCommentsQuerySchema, req);
    const postId = await comments.postIdForSlug(String(req.params.slug));
    if (!postId) throw notFound("Post not found");
    const { items, total } = await comments.list(postId, page, viewerOf(req.user));
    noStore(res);
    paginated(res, { data: items, total, page: page.page, pageSize: page.pageSize });
  });

  router.post("/posts/:slug/comments", requireVerifiedUser, deps.limiters.commentCreate, async (req, res) => {
    const input = parseBody(CreateCommentInputSchema, req);
    const postId = await comments.postIdForSlug(String(req.params.slug));
    if (!postId) throw notFound("Post not found");
    const created = await comments.create(postId, viewerOf(req.user)!, input);
    noStore(res);
    ok(res, created, 201);
  });

  router.patch("/comments/:id", requireUser, async (req, res) => {
    const { body } = parseBody(UpdateCommentInputSchema, req);
    const updated = await comments.update(commentId(req.params.id), viewerOf(req.user)!, body);
    noStore(res);
    ok(res, updated);
  });

  router.delete("/comments/:id", requireUser, async (req, res) => {
    const { postId, byAdmin } = await comments.remove(commentId(req.params.id), viewerOf(req.user)!);
    if (byAdmin) await audit(deps.db, req.user, { action: "comment.delete", targetType: "comment", targetId: commentId(req.params.id), meta: { postId } });
    res.status(204).end();
  });

  router.post("/comments/:id/report", requireUser, deps.limiters.commentCreate, async (req, res) => {
    const { reason } = parseBody(ReportCommentInputSchema, req);
    await comments.report(commentId(req.params.id), viewerOf(req.user)!, reason);
    res.status(204).end();
  });

  return router;
}
