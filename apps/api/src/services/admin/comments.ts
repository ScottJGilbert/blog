import { and, comment, commentReport, count, desc, eq, exists, inArray, isNull, post, sql, user, type DbOrTx, type SQL } from "@blog/db";
import type { AdminComment, AdminListCommentsQuery, CommentReport, CommentStatus } from "@blog/shared";
import type { Deps } from "../../deps";
import { notFound } from "../../errors";
import { audit } from "../../lib/audit";
import { iso } from "./common";

type Actor = { id: string };

const columns = {
  id: comment.id,
  parentId: comment.parentId,
  body: comment.body,
  status: comment.status,
  createdAt: comment.createdAt,
  editedAt: comment.editedAt,
  authorId: user.id,
  authorName: user.name,
  authorEmail: user.email,
  postId: post.id,
  postSlug: post.slug,
  postTitle: post.title,
  postSection: post.section,
};

export function createAdminCommentsService(deps: Deps) {
  const { db } = deps;

  const base = (tx: DbOrTx = db) =>
    tx
      .select(columns)
      .from(comment)
      .innerJoin(post, eq(post.id, comment.postId))
      .leftJoin(user, eq(user.id, comment.authorId));

  async function hydrate(rows: Array<Awaited<ReturnType<ReturnType<typeof base>["limit"]>>[number]>, tx: DbOrTx = db): Promise<AdminComment[]> {
    const ids = rows.map((r) => r.id);
    const reports = new Map<string, CommentReport[]>();
    if (ids.length > 0) {
      const rr = await tx
        .select({
          id: commentReport.id,
          commentId: commentReport.commentId,
          reason: commentReport.reason,
          createdAt: commentReport.createdAt,
          resolvedAt: commentReport.resolvedAt,
          reporterId: commentReport.reporterId,
          reporterName: user.name,
        })
        .from(commentReport)
        .innerJoin(user, eq(user.id, commentReport.reporterId))
        .where(inArray(commentReport.commentId, ids))
        .orderBy(desc(commentReport.createdAt));
      for (const r of rr) {
        const list = reports.get(r.commentId) ?? [];
        list.push({ id: r.id, reporter: { id: r.reporterId, name: r.reporterName }, reason: r.reason, createdAt: r.createdAt.toISOString(), resolvedAt: iso(r.resolvedAt) });
        reports.set(r.commentId, list);
      }
    }
    return rows.map((r) => {
      const list = reports.get(r.id) ?? [];
      return {
        id: r.id,
        parentId: r.parentId,
        body: r.body,
        status: r.status,
        author: r.authorId ? { id: r.authorId, name: r.authorName ?? "", email: r.authorEmail ?? "" } : null,
        post: { id: r.postId, slug: r.postSlug, title: r.postTitle, section: r.postSection },
        reports: list,
        openReportCount: list.filter((x) => x.resolvedAt === null).length,
        createdAt: r.createdAt.toISOString(),
        editedAt: iso(r.editedAt),
      };
    });
  }

  async function getOne(id: string, tx: DbOrTx = db): Promise<AdminComment> {
    const rows = await base(tx).where(eq(comment.id, id)).limit(1);
    if (rows.length === 0) throw notFound("Comment not found");
    return (await hydrate(rows, tx))[0]!;
  }

  return {
    async list(q: AdminListCommentsQuery): Promise<{ items: AdminComment[]; total: number }> {
      const conds: SQL[] = [];
      if (q.status) conds.push(eq(comment.status, q.status));
      if (q.reported) {
        conds.push(exists(db.select({ one: sql`1` }).from(commentReport).where(and(eq(commentReport.commentId, comment.id), isNull(commentReport.resolvedAt)))));
      }
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [totals]] = await Promise.all([
        base()
          .where(where)
          .orderBy(desc(comment.createdAt), desc(comment.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db.select({ n: count() }).from(comment).where(where),
      ]);
      return { items: await hydrate(rows), total: totals?.n ?? 0 };
    },

    async setStatus(actor: Actor, id: string, status: CommentStatus): Promise<AdminComment> {
      const [existing] = await db.select({ id: comment.id, status: comment.status }).from(comment).where(eq(comment.id, id)).limit(1);
      if (!existing) throw notFound("Comment not found");
      await db.transaction(async (tx) => {
        await tx.update(comment).set({ status }).where(eq(comment.id, id));
        await audit(tx, actor, { action: "comment.status", targetType: "comment", targetId: id, meta: { from: existing.status, to: status } });
      });
      return getOne(id);
    },

    async resolveReports(actor: Actor, id: string): Promise<AdminComment> {
      const [existing] = await db.select({ id: comment.id }).from(comment).where(eq(comment.id, id)).limit(1);
      if (!existing) throw notFound("Comment not found");
      await db.transaction(async (tx) => {
        const resolved = await tx
          .update(commentReport)
          .set({ resolvedAt: deps.now() })
          .where(and(eq(commentReport.commentId, id), isNull(commentReport.resolvedAt)))
          .returning({ id: commentReport.id });
        await audit(tx, actor, { action: "comment.resolve_reports", targetType: "comment", targetId: id, meta: { resolved: resolved.length } });
      });
      return getOne(id);
    },
  };
}

export type AdminCommentsService = ReturnType<typeof createAdminCommentsService>;
