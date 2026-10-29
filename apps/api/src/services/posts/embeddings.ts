import { eq, inArray, post, postEmbedding, and, sql } from "@blog/db";
import { createHash } from "node:crypto";
import type { Deps } from "../../deps";
import { truncateForEmbedding } from "../embeddings/provider";

export type EmbedStatus = "embedded" | "skipped" | "disabled" | "failed";

interface EmbedSource {
  id: string;
  title: string;
  excerpt: string;
  contentText: string;
}

/** The text a post is embedded from: title + excerpt + plain content. */
export function embeddingText(p: Pick<EmbedSource, "title" | "excerpt" | "contentText">): string {
  return truncateForEmbedding([p.title, p.excerpt, p.contentText].filter((s) => s && s.trim() !== "").join("\n\n"));
}

const hashOf = (model: string, text: string): string => createHash("sha256").update(model).update("\0").update(text).digest("hex");

async function upsertEmbedding(deps: Deps, postId: string, hash: string, vector: number[]): Promise<void> {
  const model = deps.embeddings.model;
  await deps.db
    .insert(postEmbedding)
    .values({ postId, model, contentHash: hash, embedding: vector })
    .onConflictDoUpdate({ target: postEmbedding.postId, set: { model, contentHash: hash, embedding: vector, updatedAt: sql`now()` } });
}

/**
 * Compute (or refresh) the embedding of one post. Skips when the content hash is unchanged. Never throws:
 * provider/db failures are logged and reported as `failed`.
 */
export async function embedPost(deps: Deps, postId: string): Promise<{ status: EmbedStatus }> {
  try {
    if (!deps.embeddings.enabled) return { status: "disabled" };
    const [row] = await deps.db
      .select({ id: post.id, title: post.title, excerpt: post.excerpt, contentText: post.contentText })
      .from(post)
      .where(eq(post.id, postId))
      .limit(1);
    if (!row) return { status: "failed" };
    const text = embeddingText(row);
    const hash = hashOf(deps.embeddings.model, text);
    const [existing] = await deps.db.select({ hash: postEmbedding.contentHash, model: postEmbedding.model }).from(postEmbedding).where(eq(postEmbedding.postId, postId)).limit(1);
    if (existing && existing.hash === hash) return { status: "skipped" };
    const [vector] = await deps.embeddings.embed([text]);
    if (!vector) throw new Error("provider returned no vector");
    await upsertEmbedding(deps, postId, hash, vector);
    return { status: "embedded" };
  } catch (err) {
    deps.logger.warn({ err: err instanceof Error ? err.message : String(err), postId }, "post embedding failed");
    return { status: "failed" };
  }
}

export interface ReindexSummary {
  embedded: number;
  skipped: number;
  failed: number;
  /** Posts not looked at because the time budget ran out; start another reindex to continue (finished posts are skipped by hash). */
  remaining?: number;
}

const BATCH_SIZE = 16;
const running = new WeakMap<Deps, Promise<ReindexSummary>>();

/**
 * Embed every published post, in batches, and resolve with the totals. (`reindexAll` runs this in the background.)
 * Resumable: posts whose content hash is unchanged are skipped, so after a stop (time budget, killed instance) running it
 * again continues where it ended. `budgetMs` > 0 stops cleanly between batches once that much time has passed (serverless
 * functions have a hard `maxDuration`).
 */
export async function runReindex(deps: Deps, opts: { budgetMs?: number } = {}): Promise<ReindexSummary> {
  const summary: ReindexSummary = { embedded: 0, skipped: 0, failed: 0 };
  const startedAt = Date.now();
  if (!deps.embeddings.enabled) return summary;
  const posts: EmbedSource[] = await deps.db
    .select({ id: post.id, title: post.title, excerpt: post.excerpt, contentText: post.contentText })
    .from(post)
    .where(eq(post.status, "published"));
  const existing = new Map<string, string>();
  if (posts.length) {
    const rows = await deps.db
      .select({ postId: postEmbedding.postId, hash: postEmbedding.contentHash })
      .from(postEmbedding)
      .where(inArray(postEmbedding.postId, posts.map((p) => p.id)));
    for (const r of rows) existing.set(r.postId, r.hash);
  }
  const model = deps.embeddings.model;
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    if (opts.budgetMs && Date.now() - startedAt > opts.budgetMs) {
      summary.remaining = posts.length - i;
      deps.logger.warn(summary, "embedding reindex stopped at its time budget; run it again to continue");
      break;
    }
    const batch = posts.slice(i, i + BATCH_SIZE);
    const todo: Array<{ p: EmbedSource; text: string; hash: string }> = [];
    for (const p of batch) {
      const text = embeddingText(p);
      const hash = hashOf(model, text);
      if (existing.get(p.id) === hash) summary.skipped++;
      else todo.push({ p, text, hash });
    }
    if (todo.length) {
      try {
        const vectors = await deps.embeddings.embed(todo.map((t) => t.text));
        for (let k = 0; k < todo.length; k++) {
          const vector = vectors[k];
          if (!vector) {
            summary.failed++;
            continue;
          }
          try {
            await upsertEmbedding(deps, todo[k]!.p.id, todo[k]!.hash, vector);
            summary.embedded++;
          } catch (err) {
            summary.failed++;
            deps.logger.warn({ err: String(err), postId: todo[k]!.p.id }, "reindex: storing embedding failed");
          }
        }
      } catch (err) {
        summary.failed += todo.length;
        deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "reindex: embedding batch failed");
      }
    }
    deps.logger.info({ done: Math.min(i + BATCH_SIZE, posts.length), total: posts.length, ...summary }, "embedding reindex progress");
  }
  return summary;
}

/**
 * Start re-embedding all published posts in the background and return how many posts were queued. The work is handed to
 * `deps.background` (Vercel `waitUntil`: the instance stays alive after the 202) and limited to
 * `config.reindexBudgetMs` per request; the job is resumable, see `runReindex`. A second call on the SAME instance while one
 * is running joins it (other instances cannot see it: a duplicate run only re-checks hashes, it is idempotent).
 * `{ queued: 0 }` when the provider is disabled.
 */
export async function reindexAll(deps: Deps): Promise<{ queued: number }> {
  if (!deps.embeddings.enabled) return { queued: 0 };
  const [{ n } = { n: 0 }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(post).where(and(eq(post.status, "published")));
  if (!running.has(deps)) {
    const p = runReindex(deps, { budgetMs: deps.config.reindexBudgetMs })
      .catch((err): ReindexSummary => {
        deps.logger.error({ err: String(err) }, "embedding reindex crashed");
        return { embedded: 0, skipped: 0, failed: 0 };
      })
      .then((s) => {
        deps.logger.info(s, "embedding reindex finished");
        return s;
      })
      .finally(() => running.delete(deps));
    running.set(deps, p);
    deps.background(p, "embedding reindex");
  }
  return { queued: n };
}

/** Resolves when a background reindex started by `reindexAll(deps)` is done (immediately when none is running). For tests/shutdown. */
export async function waitForReindex(deps: Deps): Promise<ReindexSummary | null> {
  return (await running.get(deps)) ?? null;
}
