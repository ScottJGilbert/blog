import { comment, commentReport, count, desc, eq, exists, isNull, and, post, sql, subscriber, user } from "@blog/db";
import type { Stats, SystemInfo } from "@blog/shared";
import type { Deps } from "../../deps";

export function createAdminStatsService(deps: Deps) {
  const { db } = deps;
  return {
    async stats(): Promise<Stats> {
      const [postRows, [commentTotal], [reported], [userTotal], [admins], [confirmed], [pending], recentPosts, recentComments] = await Promise.all([
        db.select({ status: post.status, n: count() }).from(post).groupBy(post.status),
        db.select({ n: count() }).from(comment),
        db
          .select({ n: count() })
          .from(comment)
          .where(exists(db.select({ one: sql`1` }).from(commentReport).where(and(eq(commentReport.commentId, comment.id), isNull(commentReport.resolvedAt))))),
        db.select({ n: count() }).from(user),
        db.select({ n: count() }).from(user).where(eq(user.role, "admin")),
        db.select({ n: count() }).from(subscriber).where(eq(subscriber.status, "confirmed")),
        db.select({ n: count() }).from(subscriber).where(eq(subscriber.status, "pending")),
        db
          .select({ id: post.id, slug: post.slug, title: post.title, section: post.section, status: post.status, updatedAt: post.updatedAt })
          .from(post)
          .orderBy(desc(post.updatedAt), desc(post.id))
          .limit(5),
        db
          .select({
            id: comment.id,
            body: comment.body,
            status: comment.status,
            authorName: user.name,
            postSlug: post.slug,
            postTitle: post.title,
            createdAt: comment.createdAt,
          })
          .from(comment)
          .innerJoin(post, eq(post.id, comment.postId))
          .leftJoin(user, eq(user.id, comment.authorId))
          .orderBy(desc(comment.createdAt), desc(comment.id))
          .limit(5),
      ]);
      const byStatus = (s: string) => postRows.find((r) => r.status === s)?.n ?? 0;
      return {
        posts: { published: byStatus("published"), draft: byStatus("draft"), scheduled: byStatus("scheduled") },
        comments: { total: commentTotal?.n ?? 0, reported: reported?.n ?? 0 },
        users: { total: userTotal?.n ?? 0, admins: admins?.n ?? 0 },
        subscribers: { confirmed: confirmed?.n ?? 0, pending: pending?.n ?? 0 },
        recentPosts: recentPosts.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
        recentComments: recentComments.map((c) => ({
          id: c.id,
          body: c.body.length > 200 ? `${c.body.slice(0, 200)}…` : c.body,
          status: c.status,
          authorName: c.authorName ?? "Deleted user",
          postSlug: c.postSlug,
          postTitle: c.postTitle,
          createdAt: c.createdAt.toISOString(),
        })),
      };
    },

    /** `GET /admin/system` — read-only environment health for the admin settings page. */
    async system(): Promise<SystemInfo> {
      let dbStatus: "up" | "down" = "up";
      try {
        await db.execute(sql`select 1`);
      } catch {
        dbStatus = "down";
      }
      const provider = deps.newsletter.kind === "listmonk" ? "listmonk" : "noop";
      return {
        db: dbStatus,
        mailer: deps.mailer.driver,
        storage: deps.storage.driver,
        embeddings: { enabled: deps.embeddings.enabled, model: deps.embeddings.model },
        newsletter: { provider, configured: provider !== "noop" },
        version: deps.config.version,
      };
    },
  };
}

export type AdminStatsService = ReturnType<typeof createAdminStatsService>;
