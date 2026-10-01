import { and, asc, count, desc, eq, inArray, post, postTag, sql, tag, user, type SQL } from "@blog/db";
import { escapeHtml, extractToc, renderHtml } from "@blog/content";
import type { ListPostsQuery, PostDetail, PostNavRef, PostSummary, SearchQuery, SearchResult, Section, SitemapEntry, TagRef, TagWithCount } from "@blog/shared";
import type { Deps } from "../../deps";

/** Columns every public post query selects (joined with the author). */
export const summaryColumns = {
  id: post.id,
  slug: post.slug,
  title: post.title,
  excerpt: post.excerpt,
  section: post.section,
  coverImageUrl: post.coverImageUrl,
  coverImageAlt: post.coverImageAlt,
  publishedAt: post.publishedAt,
  createdAt: post.createdAt,
  readingMinutes: post.readingMinutes,
  authorName: user.name,
  authorImage: user.image,
};

export interface SummaryRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  section: Section;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: Date | null;
  createdAt?: Date;
  readingMinutes: number;
  authorName: string;
  authorImage: string | null;
  tags?: TagRef[];
}

/** DB row (+ tags) → `PostSummary` DTO. */
export function toPostSummary(row: SummaryRow, tags?: TagRef[]): PostSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    section: row.section,
    tags: tags ?? row.tags ?? [],
    coverImageUrl: row.coverImageUrl,
    coverImageAlt: row.coverImageAlt,
    author: { name: row.authorName, image: row.authorImage },
    publishedAt: (row.publishedAt ?? row.createdAt ?? new Date(0)).toISOString(),
    readingMinutes: row.readingMinutes,
  };
}

/** `status = 'published' AND published_at <= now` (what readers may see). */
export const publishedWhere = (now: Date): SQL => sql`${post.status} = 'published' AND ${post.publishedAt} <= ${now.toISOString()}::timestamptz`;

/** Same condition for hand-written SQL where the post table is aliased `p`. */
const publishedP = (now: Date): SQL => sql`p.status = 'published' AND p.published_at <= ${now.toISOString()}::timestamptz`;

/** Tags of many posts at once → map postId → tags (sorted by name). */
export async function loadTags(db: Deps["db"], postIds: string[]): Promise<Map<string, TagRef[]>> {
  const map = new Map<string, TagRef[]>();
  if (postIds.length === 0) return map;
  const rows = await db
    .select({ postId: postTag.postId, slug: tag.slug, name: tag.name })
    .from(postTag)
    .innerJoin(tag, eq(tag.id, postTag.tagId))
    .where(inArray(postTag.postId, postIds))
    .orderBy(asc(tag.name));
  for (const r of rows) {
    const list = map.get(r.postId) ?? [];
    list.push({ slug: r.slug, name: r.name });
    map.set(r.postId, list);
  }
  return map;
}

/** Hydrate summaries for rows already selected with `summaryColumns`. */
export async function withTags(db: Deps["db"], rows: SummaryRow[]): Promise<PostSummary[]> {
  const tags = await loadTags(db, rows.map((r) => r.id));
  return rows.map((r) => toPostSummary(r, tags.get(r.id) ?? []));
}

const uuidList = (ids: string[]): SQL => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

const CANDIDATES = 60;
const RRF_K = 60;
/** Cosine similarity below which a vector hit is considered unrelated to the query. */
export const VECTOR_MIN_SIMILARITY = 0.25;

const MARK_OPEN = "\u0002";
const MARK_CLOSE = "\u0003";
const HEADLINE_OPTIONS = `StartSel=${MARK_OPEN}, StopSel=${MARK_CLOSE}, MaxWords=35, MinWords=15, MaxFragments=1, ShortWord=2`;

/** Escape everything except the `<mark>` markers placed by ts_headline (escaping is applied per segment between markers). */
export function markSnippet(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  let out = "";
  let open = false;
  for (const part of clean.split(/([\u0002\u0003])/)) {
    if (part === MARK_OPEN) {
      if (!open) out += "<mark>";
      open = true;
    } else if (part === MARK_CLOSE) {
      if (open) out += "</mark>";
      open = false;
    } else out += escapeHtml(part);
  }
  return open ? `${out}</mark>` : out;
}

const vectorLiteral = (v: number[]): string => `[${v.join(",")}]`;

function plainSnippet(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  return escapeHtml(t.length > max ? `${t.slice(0, max).trimEnd()}…` : t);
}

export function createPostsService(deps: Deps) {
  const { db } = deps;
  const base = () => db.select(summaryColumns).from(post).innerJoin(user, eq(user.id, post.authorId));

  async function summariesByIds(ids: string[]): Promise<PostSummary[]> {
    if (ids.length === 0) return [];
    const rows = await base().where(and(inArray(post.id, ids), publishedWhere(deps.now())));
    const byId = new Map((await withTags(db, rows)).map((s) => [s.id, s]));
    return ids.map((id) => byId.get(id)).filter((s): s is PostSummary => Boolean(s));
  }

  async function execRows<T>(query: SQL): Promise<T[]> {
    const res = await db.execute(query);
    return res.rows as T[];
  }

  return {
    async list(q: ListPostsQuery): Promise<{ items: PostSummary[]; total: number }> {
      const conds: SQL[] = [publishedWhere(deps.now())];
      if (q.section) conds.push(eq(post.section, q.section));
      if (q.tag) {
        conds.push(sql`exists (select 1 from ${postTag} pt join ${tag} t on t.id = pt.tag_id where pt.post_id = ${post.id} and t.slug = ${q.tag})`);
      }
      if (q.q) conds.push(sql`${post.searchVector} @@ websearch_to_tsquery('english', ${q.q})`);
      const where = and(...conds);
      const order = q.sort === "oldest" ? [asc(post.publishedAt), asc(post.id)] : [desc(post.publishedAt), desc(post.id)];
      const [rows, totals] = await Promise.all([
        base()
          .where(where)
          .orderBy(...order)
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db.select({ n: count() }).from(post).where(where),
      ]);
      return { items: await withTags(db, rows), total: totals[0]?.n ?? 0 };
    },

    /** Minimal lookup used to 404 sub-resources of an unknown/unpublished slug. */
    async findPublishedRef(slug: string): Promise<{ id: string; slug: string; section: Section; publishedAt: Date } | null> {
      const [row] = await db
        .select({ id: post.id, slug: post.slug, section: post.section, publishedAt: post.publishedAt })
        .from(post)
        .where(and(eq(post.slug, slug), publishedWhere(deps.now())))
        .limit(1);
      return row ? { ...row, publishedAt: row.publishedAt! } : null;
    },

    async getBySlug(slug: string): Promise<PostDetail | null> {
      const now = deps.now();
      const [row] = await db
        .select({ ...summaryColumns, content: post.content, updatedAt: post.updatedAt })
        .from(post)
        .innerJoin(user, eq(user.id, post.authorId))
        .where(and(eq(post.slug, slug), publishedWhere(now)))
        .limit(1);
      if (!row) return null;
      const tags = (await loadTags(db, [row.id])).get(row.id) ?? [];
      const publishedAt = row.publishedAt!;

      const navCols = { slug: post.slug, title: post.title, section: post.section };
      const sameSection = and(eq(post.section, row.section), publishedWhere(now));
      const [[prev], [next]] = await Promise.all([
        db
          .select(navCols)
          .from(post)
          .where(and(sameSection, sql`(${post.publishedAt}, ${post.id}) < (${publishedAt.toISOString()}::timestamptz, ${row.id}::uuid)`))
          .orderBy(desc(post.publishedAt), desc(post.id))
          .limit(1),
        db
          .select(navCols)
          .from(post)
          .where(and(sameSection, sql`(${post.publishedAt}, ${post.id}) > (${publishedAt.toISOString()}::timestamptz, ${row.id}::uuid)`))
          .orderBy(asc(post.publishedAt), asc(post.id))
          .limit(1),
      ]);

      return {
        ...toPostSummary(row, tags),
        content: row.content as PostDetail["content"],
        // renderHtml and extractToc share the same slug allocator (no prefix) so toc ids === heading ids
        contentHtml: renderHtml(row.content, { target: "web" }),
        toc: extractToc(row.content),
        updatedAt: row.updatedAt.toISOString(),
        prev: (prev as PostNavRef | undefined) ?? null,
        next: (next as PostNavRef | undefined) ?? null,
      };
    },

    /**
     * Related posts: pgvector cosine similarity when the post has an embedding, topped up with tag overlap, then the
     * newest posts of the same section. Never contains the post itself; `[]` for an unknown/unpublished slug.
     */
    async related(slug: string, limit: number): Promise<PostSummary[]> {
      const self = await this.findPublishedRef(slug);
      if (!self) return [];
      const now = deps.now();
      const chosen: string[] = [];
      const exclusion = () => sql`AND p.id NOT IN (${uuidList([self.id, ...chosen])})`;

      // 1. vectors
      try {
        const hasVector = await execRows<{ one: number }>(sql`select 1 as one from post_embedding where post_id = ${self.id}::uuid`);
        if (hasVector.length > 0) {
          const rows = await execRows<{ id: string }>(sql`
            select p.id from post_embedding e
            join post p on p.id = e.post_id
            where ${publishedP(now)} and e.post_id <> ${self.id}::uuid
            order by e.embedding <=> (select embedding from post_embedding where post_id = ${self.id}::uuid), p.published_at desc
            limit ${limit}`);
          chosen.push(...rows.map((r) => r.id));
        }
      } catch (err) {
        deps.logger.warn({ err: String(err) }, "related: vector lookup failed, falling back");
      }

      // 2. tag overlap
      if (chosen.length < limit) {
        const rows = await execRows<{ id: string }>(sql`
          select p.id, count(*) as shared from post_tag mine
          join post_tag other on other.tag_id = mine.tag_id and other.post_id <> mine.post_id
          join post p on p.id = other.post_id
          where mine.post_id = ${self.id}::uuid and ${publishedP(now)} ${exclusion()}
          group by p.id, p.published_at
          order by shared desc, p.published_at desc, p.id desc
          limit ${limit - chosen.length}`);
        chosen.push(...rows.map((r) => r.id));
      }

      // 3. newest in the same section
      if (chosen.length < limit) {
        const rows = await execRows<{ id: string }>(sql`
          select p.id from post p
          where ${publishedP(now)} and p.section = ${self.section} ${exclusion()}
          order by p.published_at desc, p.id desc
          limit ${limit - chosen.length}`);
        chosen.push(...rows.map((r) => r.id));
      }
      return summariesByIds(chosen);
    },

    /**
     * Hybrid search: websearch full-text rank fused (reciprocal rank fusion) with vector similarity when the
     * embedding provider is enabled and embeddings exist. Always works FTS-only.
     */
    async search(q: SearchQuery): Promise<{ items: SearchResult[]; total: number }> {
      const now = deps.now();
      const text = q.q.trim();
      const sectionCond = q.section ? sql`AND p.section = ${q.section}` : sql``;
      const tsq = sql`websearch_to_tsquery('english', ${text})`;

      const fts = await execRows<{ id: string }>(sql`
        select p.id from post p
        where ${publishedP(now)} ${sectionCond} and p.search_vector @@ ${tsq}
        order by ts_rank_cd(p.search_vector, ${tsq}, 32) desc, p.published_at desc, p.id desc
        limit ${CANDIDATES}`);
      const ftsIds = fts.map((r) => r.id);

      let vectorIds: string[] = [];
      if (deps.embeddings.enabled) {
        try {
          const [vec] = await deps.embeddings.embed([text]);
          if (vec) {
            const lit = vectorLiteral(vec);
            const rows = await execRows<{ id: string }>(sql`
              select p.id from post_embedding e
              join post p on p.id = e.post_id
              where ${publishedP(now)} ${sectionCond} and 1 - (e.embedding <=> ${lit}::vector) >= ${VECTOR_MIN_SIMILARITY}
              order by e.embedding <=> ${lit}::vector
              limit ${CANDIDATES}`);
            vectorIds = rows.map((r) => r.id);
          }
        } catch (err) {
          deps.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "search: vector side failed, using full-text only");
        }
      }

      // last resort for stop-word-only / prefix queries: substring match on the title
      let likeIds: string[] = [];
      if (ftsIds.length === 0 && vectorIds.length === 0) {
        const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const rows = await execRows<{ id: string }>(sql`
          select p.id from post p
          where ${publishedP(now)} ${sectionCond} and (p.title ilike ${pattern} or p.excerpt ilike ${pattern})
          order by p.published_at desc, p.id desc
          limit ${CANDIDATES}`);
        likeIds = rows.map((r) => r.id);
      }

      const score = new Map<string, number>();
      for (const list of [ftsIds, vectorIds, likeIds]) {
        list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
      }
      const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
      const total = ranked.length;
      const pageIds = ranked.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      if (pageIds.length === 0) return { items: [], total };

      const summaries = await summariesByIds(pageIds);
      const heads = await execRows<{ id: string; excerpt: string; content_text: string; h_content: string; h_excerpt: string }>(sql`
        select p.id, p.excerpt, p.content_text,
          ts_headline('english', p.content_text, ${tsq}, ${HEADLINE_OPTIONS}) as h_content,
          ts_headline('english', p.excerpt, ${tsq}, ${HEADLINE_OPTIONS}) as h_excerpt
        from post p where p.id in (${uuidList(pageIds)})`);
      const headById = new Map(heads.map((h) => [h.id, h]));

      const items = summaries.map((s): SearchResult => {
        const h = headById.get(s.id);
        let snippet: string;
        if (h?.h_content?.includes(MARK_OPEN)) snippet = markSnippet(h.h_content);
        else if (h?.h_excerpt?.includes(MARK_OPEN)) snippet = markSnippet(h.h_excerpt);
        else snippet = plainSnippet(h?.excerpt || h?.content_text || s.excerpt);
        return { ...s, snippet, score: Number((score.get(s.id) ?? 0).toFixed(6)) };
      });
      return { items, total };
    },

    async tags(): Promise<TagWithCount[]> {
      const rows = await db
        .select({ slug: tag.slug, name: tag.name, count: count() })
        .from(tag)
        .innerJoin(postTag, eq(postTag.tagId, tag.id))
        .innerJoin(post, eq(post.id, postTag.postId))
        .where(publishedWhere(deps.now()))
        .groupBy(tag.id, tag.slug, tag.name)
        .orderBy(desc(count()), asc(tag.name));
      return rows;
    },

    async sitemap(): Promise<SitemapEntry[]> {
      const rows = await db
        .select({ section: post.section, slug: post.slug, updatedAt: post.updatedAt })
        .from(post)
        .where(publishedWhere(deps.now()))
        .orderBy(desc(post.publishedAt), desc(post.id));
      return rows.map((r) => ({ section: r.section, slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
    },

    /** Newest published posts with their Lexical content, for the RSS feed. */
    async feedItems(section: Section | undefined, limit = 30) {
      const conds = [publishedWhere(deps.now())];
      if (section) conds.push(eq(post.section, section));
      const rows = await db
        .select({ ...summaryColumns, content: post.content, updatedAt: post.updatedAt })
        .from(post)
        .innerJoin(user, eq(user.id, post.authorId))
        .where(and(...conds))
        .orderBy(desc(post.publishedAt), desc(post.id))
        .limit(limit);
      const tags = await loadTags(db, rows.map((r) => r.id));
      return rows.map((r) => ({ summary: toPostSummary(r, tags.get(r.id) ?? []), content: r.content, updatedAt: r.updatedAt }));
    },
  };
}

export type PostsService = ReturnType<typeof createPostsService>;
export { embedPost, reindexAll } from "./embeddings";
