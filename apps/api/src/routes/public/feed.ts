import { renderHtml } from "@blog/content";
import { FeedQuerySchema, type Section } from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { parseQuery } from "../../lib/validate";
import type { PostsService } from "../../services/posts";
import { cachePublic } from "./cache";

/** Remove characters that are illegal in XML 1.0, then escape the five XML specials. */
export function xmlEscape(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** CDATA section whose payload can safely contain `]]>`. */
export function cdata(s: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
  return `<![CDATA[${clean.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

const SECTION_TITLES: Record<Section, string> = { personal: "Personal", engineering: "Engineering" };

export interface FeedItemInput {
  title: string;
  slug: string;
  section: Section;
  excerpt: string;
  publishedAt: string;
  authorName: string;
  tags: Array<{ name: string }>;
  html: string;
}

export function buildRss(input: { siteUrl: string; siteName: string; section?: Section; lastBuildDate: Date; items: FeedItemInput[] }): string {
  const site = input.siteUrl.replace(/\/+$/, "");
  const title = input.section ? `${input.siteName} — ${SECTION_TITLES[input.section]}` : input.siteName;
  const selfUrl = `${site}/feed.xml${input.section ? `?section=${input.section}` : ""}`;
  const channelLink = input.section ? `${site}/${input.section}` : site;
  const description = input.section ? `Latest ${SECTION_TITLES[input.section].toLowerCase()} posts from ${input.siteName}` : `Latest posts from ${input.siteName}`;
  const items = input.items
    .map((i) => {
      const link = `${site}/${i.section}/${i.slug}`;
      return [
        "    <item>",
        `      <title>${xmlEscape(i.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        `      <pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate>`,
        `      <dc:creator>${xmlEscape(i.authorName)}</dc:creator>`,
        `      <category>${xmlEscape(SECTION_TITLES[i.section])}</category>`,
        ...i.tags.map((t) => `      <category>${xmlEscape(t.name)}</category>`),
        `      <description>${xmlEscape(i.excerpt)}</description>`,
        `      <content:encoded>${cdata(i.html)}</content:encoded>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(channelLink)}</link>
    <description>${xmlEscape(description)}</description>
    <language>en</language>
    <lastBuildDate>${input.lastBuildDate.toUTCString()}</lastBuildDate>
    <generator>blog-api</generator>
    <atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

/** `GET /feed.xml?section=` — RSS 2.0 with full HTML content (`renderHtml` target `rss`). */
export function feedRouter(deps: Deps, posts: PostsService): Router {
  const router = Router();
  router.get("/feed.xml", deps.limiters.publicRead, async (req, res) => {
    const { section } = parseQuery(FeedQuerySchema, req);
    const rows = await posts.feedItems(section, 30);
    const baseUrl = deps.config.siteUrl.replace(/\/+$/, "");
    const items: FeedItemInput[] = rows.map(({ summary, content }) => ({
      title: summary.title,
      slug: summary.slug,
      section: summary.section,
      excerpt: summary.excerpt,
      publishedAt: summary.publishedAt,
      authorName: summary.author.name,
      tags: summary.tags,
      html: renderHtml(content, { target: "rss", baseUrl }),
    }));
    const newest = rows.reduce<Date | null>((acc, r) => (!acc || r.updatedAt > acc ? r.updatedAt : acc), null);
    const xml = buildRss({ siteUrl: baseUrl, siteName: deps.config.siteName, section, lastBuildDate: newest ?? deps.now(), items });
    cachePublic(res);
    res.type("application/rss+xml; charset=utf-8").send(xml);
  });
  return router;
}
