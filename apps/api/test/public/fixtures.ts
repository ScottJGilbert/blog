import { randomUUID } from "node:crypto";
import { post, postEmbedding, postTag, tag, user } from "@blog/db";
import { markdownToContent, readingMinutes, slugify, toExcerpt, toPlainText } from "@blog/content";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "../../src/services/embeddings";
import { createUser, type TestApp } from "../helpers";

export interface PostFixture {
  slug: string;
  title?: string;
  section?: "personal" | "engineering";
  status?: "draft" | "scheduled" | "published" | "archived";
  /** default: 1 day before `base` */
  publishedAt?: Date | null;
  scheduledFor?: Date | null;
  tags?: string[];
  markdown?: string;
  excerpt?: string;
  authorId?: string;
}

export const BASE = new Date("2026-06-15T12:00:00.000Z");
export const daysAgo = (n: number, base = BASE) => new Date(base.getTime() - n * 86_400_000);

let authorId: string | undefined;
export async function ensureAuthor(t: TestApp): Promise<string> {
  const u = await createUser(t, { name: "Ada Author", email: `author-${randomUUID().slice(0, 6)}@example.com`, role: "admin" });
  authorId = u.id;
  return u.id;
}

/** Insert a post straight into the DB (content parsed from markdown, derived columns computed like the admin API does). */
export async function insertPost(t: TestApp, f: PostFixture): Promise<string> {
  const author = f.authorId ?? (await t.db.select({ id: user.id }).from(user).limit(1))[0]?.id ?? (await ensureAuthor(t));
  const content = markdownToContent(f.markdown ?? `# ${f.title ?? f.slug}\n\nSome body text for ${f.slug}.`);
  const status = f.status ?? "published";
  const publishedAt = f.publishedAt === undefined ? (status === "published" ? daysAgo(1) : null) : f.publishedAt;
  const [row] = await t.db
    .insert(post)
    .values({
      slug: f.slug,
      title: f.title ?? f.slug,
      excerpt: f.excerpt ?? toExcerpt(content, 160),
      section: f.section ?? "engineering",
      status,
      content: content as never,
      contentText: toPlainText(content),
      authorId: author,
      publishedAt,
      scheduledFor: f.scheduledFor ?? (status === "scheduled" ? daysAgo(-1) : null),
      readingMinutes: readingMinutes(content),
    })
    .returning({ id: post.id });
  for (const name of f.tags ?? []) {
    const slug = slugify(name);
    const [t1] = await t.db.insert(tag).values({ slug, name }).onConflictDoUpdate({ target: tag.slug, set: { name } }).returning({ id: tag.id });
    await t.db.insert(postTag).values({ postId: row!.id, tagId: t1!.id });
  }
  return row!.id;
}

/** Store a vector for a post directly. */
export async function setEmbedding(t: TestApp, postId: string, vector: number[], model = "fake-model"): Promise<void> {
  await t.db.insert(postEmbedding).values({ postId, model, contentHash: `fixture-${randomUUID()}`, embedding: vector }).onConflictDoUpdate({ target: postEmbedding.postId, set: { embedding: vector } });
}

export const TOPICS = ["alpha", "bravo", "charlie", "delta", "echo"] as const;
/** Unit-ish vector pointing mostly at one topic axis (plus an optional blend). */
export function topicVector(weights: Partial<Record<(typeof TOPICS)[number], number>>): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  TOPICS.forEach((name, i) => (v[i] = weights[name] ?? 0));
  v[EMBEDDING_DIMENSIONS - 1] = 0.01;
  return v;
}

/** Deterministic fake: a text gets weight 1 on every topic keyword it contains (so "alpha bravo" is between them). */
export class FakeEmbeddings implements EmbeddingProvider {
  readonly enabled = true;
  readonly model = "fake-model";
  calls: string[][] = [];
  fail = false;
  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    if (this.fail) throw new Error("embedding upstream down");
    return texts.map((text) => {
      const lower = text.toLowerCase();
      const w: Partial<Record<(typeof TOPICS)[number], number>> = {};
      for (const topic of TOPICS) if (lower.includes(topic)) w[topic] = 1;
      return topicVector(w);
    });
  }
}
