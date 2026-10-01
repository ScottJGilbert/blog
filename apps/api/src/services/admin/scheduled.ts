import { post, sql } from "@blog/db";
import type { Deps } from "../../deps";
import { audit } from "../../lib/audit";
import { postTags } from "../../lib/revalidate";
import { embedPost } from "../posts";

export interface PublishDueResult {
  published: number;
  slugs: string[];
}

/**
 * Publish every `scheduled` post whose `scheduled_for` has passed.
 *
 * One `UPDATE … WHERE status = 'scheduled' AND scheduled_for <= now RETURNING …` does the claim: concurrent invocations
 * block on the row locks, re-check the WHERE clause (READ COMMITTED) and skip rows another run already flipped, so a post
 * is published (and revalidated / embedded) exactly once. `published_at` becomes the planned time (`scheduled_for`, which
 * is ≤ now) and `scheduled_for` is cleared, which satisfies `post_published_has_date` / `post_scheduled_has_date`.
 */
export async function publishDuePosts(deps: Deps): Promise<PublishDueResult> {
  const now = deps.now();
  const rows = await deps.db
    .update(post)
    .set({ status: "published", publishedAt: sql`${post.scheduledFor}`, scheduledFor: null, updatedAt: sql`now()` })
    .where(sql`${post.status} = 'scheduled' AND ${post.scheduledFor} <= ${now.toISOString()}::timestamptz`)
    .returning({ id: post.id, slug: post.slug, section: post.section });
  if (rows.length === 0) return { published: 0, slugs: [] };

  for (const r of rows) {
    await audit(deps.db, null, { action: "post.publish_scheduled", targetType: "post", targetId: r.id, meta: { slug: r.slug } });
  }
  const tags = new Set<string>(["tags"]);
  for (const r of rows) for (const t of postTags(r)) tags.add(t);
  await deps.revalidate([...tags]);
  // embedding is best effort and never throws; awaited here because a serverless invocation may freeze after the response
  await Promise.allSettled(rows.map((r) => embedPost(deps, r.id)));
  return { published: rows.length, slugs: rows.map((r) => r.slug) };
}
