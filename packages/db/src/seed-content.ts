/**
 * Demo content for the seed: realistic posts whose Lexical JSON covers (almost) every BCF v1 node type.
 * Text-heavy parts are written as Markdown and converted by `@blog/content`; the rest are hand-built nodes
 * (the shapes the editor package emits).
 */
import { markdownToContent, type Content } from "@blog/content";
import type { LexicalJson } from "./schema/types";

type Raw = Record<string, unknown>;

const text = (t: string, format = 0): Raw => ({ detail: 0, format, mode: "normal", style: "", text: t, type: "text", version: 1 });
const element = (type: string, children: Raw[], extra: Raw = {}): Raw => ({ children, direction: "ltr", format: "", indent: 0, type, version: 1, ...extra });
export const paragraph = (...children: Raw[]): Raw => element("paragraph", children, { textFormat: 0, textStyle: "" });
const p = (s: string) => paragraph(text(s));

export const equation = (tex: string, inline = false): Raw => ({ type: "equation", version: 1, equation: tex, inline });
export const youtube = (id: string): Raw => ({ type: "youtube", version: 1, format: "", videoID: id });
export const tweet = (id: string): Raw => ({ type: "tweet", version: 1, format: "", id });
export const figma = (id: string): Raw => ({ type: "figma", version: 1, format: "", documentID: id });
export const hr = (): Raw => ({ type: "horizontalrule", version: 1 });
export const datetime = (iso: string): Raw => ({ type: "datetime", version: 1, dateTime: iso });
export const mention = (name: string): Raw => ({ detail: 1, format: 0, mode: "segmented", style: "", text: name, type: "mention", version: 1, mentionName: name });
export const emoji = (t: string, className: string): Raw => ({ detail: 0, format: 0, mode: "token", style: "", text: t, type: "emoji", version: 1, className });
export const hashtag = (t: string): Raw => ({ detail: 0, format: 0, mode: "normal", style: "", text: t, type: "hashtag", version: 1 });
export const keyword = (t: string): Raw => ({ detail: 0, format: 0, mode: "normal", style: "", text: t, type: "keyword", version: 1 });
export const special = (t: string): Raw => ({ detail: 0, format: 0, mode: "normal", style: "", text: t, type: "specialText", version: 1 });
export const mark = (t: string, id: string): Raw => element("mark", [text(t)], { ids: [id] });
export const inlineText = text;
export const tab = (): Raw => ({ detail: 2, format: 0, mode: "normal", style: "", text: "\t", type: "tab", version: 1 });

export function image(src: string, alt: string, caption?: string, width = 0, height = 0): Raw {
  return {
    type: "image",
    version: 1,
    src,
    altText: alt,
    width,
    height,
    maxWidth: 720,
    showCaption: Boolean(caption),
    caption: { editorState: { root: { children: caption ? [p(caption)] : [], direction: null, format: "", indent: 0, type: "root", version: 1 } } },
  };
}

export function table(rows: string[][]): Raw {
  return element(
    "table",
    rows.map((cells, r) =>
      element(
        "tablerow",
        cells.map((c) => element("tablecell", [p(c)], { headerState: r === 0 ? 1 : 0, colSpan: 1, rowSpan: 1, backgroundColor: null })),
      ),
    ),
  );
}

export const collapsible = (title: string, body: string[], open = false): Raw =>
  element("collapsible-container", [element("collapsible-title", [text(title)]), element("collapsible-content", body.map(p))], { open });

export const layout = (columns: string[][], template = "1fr 1fr"): Raw =>
  element(
    "layout-container",
    columns.map((col) => element("layout-item", col.map(p))),
    { templateColumns: template },
  );

/** Build a document from Markdown chunks (strings) and raw nodes. */
export function doc(...parts: (string | Raw)[]): LexicalJson {
  const children: unknown[] = [];
  for (const part of parts) {
    if (typeof part === "string") children.push(...(markdownToContent(part) as Content).root.children);
    else children.push(part);
  }
  return { root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children } } as LexicalJson;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------------------------------------------------
export const SEED_TAGS = [
  { slug: "typescript", name: "TypeScript" },
  { slug: "api-design", name: "API design" },
  { slug: "postgres", name: "Postgres" },
  { slug: "search", name: "Search" },
  { slug: "pgvector", name: "pgvector" },
  { slug: "performance", name: "Performance" },
  { slug: "writing", name: "Writing" },
  { slug: "life", name: "Life" },
  { slug: "web", name: "Web" },
  { slug: "travel", name: "Travel" },
  { slug: "outdoors", name: "Outdoors" },
] as const;

export interface SeedPost {
  slug: string;
  title: string;
  section: "personal" | "engineering";
  status: "published" | "draft";
  publishedAt?: string;
  tags: string[];
  cover?: { url: string; alt: string };
  /** hand-written excerpt (otherwise derived from the content) */
  excerpt?: string;
  content: LexicalJson;
}

const pic = (seed: string, w = 1600, h = 900) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

export const SEED_POSTS: SeedPost[] = [
  {
    slug: "typed-api-client-shared-by-server-and-browser",
    title: "A Typed API Client Shared by the Server and the Browser",
    section: "engineering",
    status: "published",
    publishedAt: "2026-09-18T09:00:00.000Z",
    tags: ["typescript", "api-design"],
    cover: { url: pic("typed-client"), alt: "Abstract grid of interlocking blocks" },
    excerpt: "One zod schema per DTO, one fetch wrapper, and a client that works in React Server Components and in the browser without ceremony.",
    content: doc(
      `One of the cheapest ways to keep a full-stack app honest is to define every request and response **once**, as a schema, and make both sides import it. This post walks through the small client I use for this blog's API.

## The contract is the schema

Each DTO is a [zod](https://zod.dev) schema. The TypeScript type is *inferred*, never written by hand:

\`\`\`ts
export const PostSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  section: z.enum(["personal", "engineering"]),
  publishedAt: z.iso.datetime(),
});
export type PostSummary = z.infer<typeof PostSummarySchema>;
\`\`\`

The API validates incoming data with the same schemas it later exports, so a breaking change is a compile error in the web app rather than a production incident.

## One wrapper, three behaviours

The client is a thin layer over \`fetch\` that does three things:

1. unwraps the \`{ data, meta }\` envelope,
2. turns every non-2xx response into a typed \`ApiError\`,
3. passes through \`RequestInit\`, including Next.js' \`next: { revalidate, tags }\`.

> Treat the error envelope as part of the API. A \`code\` such as \`validation_error\` is something a UI can branch on; a message string is not.

### Error codes

`,
      table([
        ["Code", "HTTP status", "Typical cause"],
        ["validation_error", "400", "Body or query failed schema validation"],
        ["unauthorized", "401", "No or expired session"],
        ["forbidden", "403", "Signed in, but not allowed"],
        ["not_found", "404", "Unknown slug or id"],
        ["conflict", "409", "Duplicate slug or state clash"],
        ["rate_limited", "429", "Too many requests from one client"],
      ]),
      `
## Using it from a Server Component

\`\`\`ts
const api = createApiClient({ baseUrl: process.env.API_INTERNAL_URL! });
const { data: posts, meta } = await api.publicPosts({ section: "engineering" }, { next: { revalidate: 300 } });
\`\`\`

Because the call is plain \`fetch\`, the framework's cache and tag invalidation work exactly as documented. When an admin publishes a post the API pings the web app, which calls \`revalidateTag("posts")\`.

---

## Lessons learned
`,
      collapsible(
        "Should responses be validated at runtime on the client?",
        [
          "Usually no: the server already validated its own output in tests, and parsing large payloads in the browser costs time.",
          "I keep an opt-in switch that parses every response, and turn it on in tests and in development to catch drift early.",
        ],
        true,
      ),
      p("Keeping the schemas in a package of their own means the admin app, the public site and the test suite all agree on one definition."),
    ),
  },
  {
    slug: "postgres-full-text-search-with-weighted-ranking",
    title: "Postgres Full-Text Search with Weighted Ranking",
    section: "engineering",
    status: "published",
    publishedAt: "2026-08-27T08:30:00.000Z",
    tags: ["postgres", "search", "performance"],
    cover: { url: pic("fts-ranking"), alt: "Index cards sorted on a desk" },
    content: doc(
      `You do not need a separate search service for a blog. Postgres ships with a capable full-text engine, and a **generated column** keeps the index in sync for free.

## Weighted tsvector

Title matches should beat body matches. Postgres lets you attach a weight (\`A\` to \`D\`) to each part of the document:

\`\`\`sql
ALTER TABLE post ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(content_text, '')), 'C')
) STORED;

CREATE INDEX post_search_idx ON post USING gin (search_vector);
\`\`\`

The query side uses \`websearch_to_tsquery\`, which understands quotes and \`-exclusions\` the way people expect:

\`\`\`sql
SELECT slug, ts_rank(search_vector, q) AS rank
FROM post, websearch_to_tsquery('english', 'postgres "full text"') q
WHERE search_vector @@ q
ORDER BY rank DESC
LIMIT 10;
\`\`\`

## Highlighted snippets

\`ts_headline\` produces the snippet shown in results. Ask it for \`<mark>\` tags and escape everything else before it reaches the page.

## How the weights compare
`,
      table([
        ["Weight", "Field", "Default ts_rank factor"],
        ["A", "Title", "1.0"],
        ["B", "Excerpt", "0.4"],
        ["C", "Body", "0.2"],
        ["D", "(unused)", "0.1"],
      ]),
      `
Ranking is a weighted sum of term frequencies. Roughly,`,
      equation("\\text{rank}(d, q) = \\sum_{t \\in q} w_{field(t)} \\cdot \\operatorname{tf}(t, d)"),
      `
## Performance notes

- A GIN index on the generated column keeps queries in the low milliseconds for tens of thousands of posts.
- Updating \`content_text\` automatically refreshes the vector; there is no trigger to forget.
- Use \`ts_rank_cd\` if phrase proximity matters to you.
`,
      collapsible("Why English only?", ["The text search configuration decides stemming and stop words. This blog is written in English, so one configuration is enough; multilingual sites should store a language per row."]),
    ),
  },
  {
    slug: "hybrid-search-fusing-full-text-and-vectors",
    title: "Hybrid Search: Fusing Full-Text and Vectors with pgvector",
    section: "engineering",
    status: "published",
    publishedAt: "2026-07-09T10:15:00.000Z",
    tags: ["postgres", "pgvector", "search"],
    cover: { url: pic("hybrid-search"), alt: "Two overlapping gradient circles" },
    content: doc(
      `Keyword search is precise, vector search is forgiving. Fusing both gives results that feel *smart* without losing exact matches.

## Embeddings in the database

With the \`pgvector\` extension an embedding is just a column, and an HNSW index makes nearest-neighbour search fast:

\`\`\`sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE post_embedding (
  post_id uuid PRIMARY KEY REFERENCES post (id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL
);

CREATE INDEX ON post_embedding USING hnsw (embedding vector_cosine_ops);
\`\`\`

## Reciprocal rank fusion

Scores from two engines are not comparable, but *ranks* are. Reciprocal rank fusion adds up \`1 / (k + rank)\` over every list a document appears in:
`,
      paragraph(equation("\\mathrm{RRF}(d) = \\sum_{r \\in R} \\frac{1}{k + r(d)}", false)),
      `
With \`k = 60\` the exact constant hardly matters; what matters is that a document near the top of *either* list rises.

### Which engine wins?
`,
      layout([
        ["Full-text is better when the reader types an exact term, an error message or an identifier."],
        ["Vectors are better for questions and paraphrases: \"how do I keep my index in sync?\" finds the generated column post."],
      ]),
      `
## Graceful degradation

If no embedding provider is configured the site simply uses full-text ranking. Related posts fall back to tag overlap. Nothing breaks; it just feels a little less clever.

A short talk on the subject:
`,
      youtube("dQw4w9WgXcQ"),
      p("Whatever you pick, measure with real queries from your logs rather than intuition."),
    ),
  },
  {
    slug: "notes-from-a-slow-morning",
    title: "Notes from a Slow Morning",
    section: "personal",
    status: "published",
    publishedAt: "2026-09-02T06:45:00.000Z",
    tags: ["life", "writing"],
    cover: { url: pic("slow-morning"), alt: "Steam rising from a mug beside a window" },
    content: doc(
      `I woke before the alarm today, which almost never happens, and decided not to reach for my phone.

## The first hour

The kettle takes four minutes. I used to fill that time with headlines; today I watched the light move across the counter instead. It turns out four minutes is *plenty* of time to notice things.

> Attention is the rarest and purest form of generosity. — Simone Weil

A few things I noticed:

- the neighbour's cat has a new routine,
- the radiator ticks twice before it warms up,
- my handwriting is worse than I remembered.

---

## Why write it down?

Because mornings like this one slip away. Writing a post is a small way of making an hour *last*.
`,
      paragraph(inlineText("Written on "), datetime("2026-09-02T06:45:00.000Z"), inlineText(" with thanks to "), mention("Maya"), inlineText(" for the book recommendation "), emoji(":)", "happysmile"), inlineText(".")),
      paragraph(inlineText("Filed under "), hashtag("#slowliving"), inlineText(", or perhaps "), keyword("gratitude"), inlineText(".")),
    ),
  },
  {
    slug: "what-i-learned-rebuilding-my-blog",
    title: "What I Learned Rebuilding My Blog from Scratch",
    section: "personal",
    status: "published",
    publishedAt: "2026-06-14T12:00:00.000Z",
    tags: ["writing", "web"],
    cover: { url: pic("rebuild-blog"), alt: "A desk with a laptop and handwritten notes" },
    content: doc(
      `This blog started life as a single-page experiment. A year later it has an API, an admin app and a newsletter. Here is what I would tell my past self.

## Start with the content format

I spent weeks on styling before I realised the *shape of the data* mattered more. Storing posts as structured JSON, not HTML, meant I could render them on the server, send them in email and index them for search from the same source.

## A checklist I wish I had kept

- [x] Decide where the content lives
- [x] Write the first ten posts before the design
- [ ] Add analytics (maybe, with consent)
- [x] Make the site fast on a bad phone
- [ ] Publish more often

`,
      paragraph(inlineText("The single most useful rule was "), mark("write for one specific reader", "rule-1"), inlineText(".")),
      image(pic("rebuild-desk", 1200, 675), "Notebook with a sketch of the site layout", "My first sketch of the site: the layout survived, the colours did not.", 1200, 675),
      `
## Keep it boring

Boring technology is a gift to your future self. I would rather spend the weekend writing than debugging a clever build.

Read more on [keeping a small web footprint](https://example.com/small-web) or just [say hello](mailto:hello@example.com).
`,
      special("[draft]"),
    ),
  },
  {
    slug: "trail-notes-three-days-in-the-cascades",
    title: "Trail Notes: Three Days in the Cascades",
    section: "personal",
    status: "published",
    publishedAt: "2026-05-03T17:20:00.000Z",
    tags: ["travel", "outdoors"],
    cover: { url: pic("cascades-trail"), alt: "A narrow trail climbing through pine forest" },
    content: doc(
      `Three days, one tent and far too many snacks. These are the notes I scribbled at the end of each day.

## Day one: the long climb

We started at 7 a.m. and gained 1,200 metres before lunch. The forest was so quiet I could hear my own boots.

1. Fill every bottle at the trailhead.
2. Start slower than feels necessary.
3. Eat *before* you are hungry.

## Day two: the ridge
`,
      image(pic("cascades-ridge", 1200, 800), "A ridge line at sunrise with low clouds in the valley", "Sunrise from the ridge, 5:48 a.m.", 1200, 800),
      `
The wind picked up around noon. We sat behind a boulder and ate cold noodles; I have never enjoyed a meal more.

## Day three: down

Knees complain, spirits soar. A rough packing list for next time:
`,
      table([
        ["Item", "Weight (g)", "Verdict"],
        ["Tent", "1,450", "Keep"],
        ["Stove + fuel", "420", "Keep"],
        ["Second jacket", "600", "Leave it"],
      ]),
      tweet("20"),
      paragraph(inlineText("Next summer:"), tab(), inlineText("the coast.")),
    ),
  },
  {
    slug: "draft-designing-a-comment-system",
    title: "Designing a Comment System Without Regret (draft)",
    section: "engineering",
    status: "draft",
    tags: ["api-design"],
    content: doc(
      `This is a **draft** used to demonstrate the admin editor. It is not visible on the public site.

## Outline

- depth-one threads only
- soft deletes, so replies keep their context
- reports with a moderation queue
`,
      figma("AbCdEfGhIjKlMnOpQrStUv"),
    ),
  },
];
