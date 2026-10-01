import { SaxesParser } from "saxes";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp, type TestApp } from "../helpers";
import { buildRss, cdata, xmlEscape } from "../../src/routes/public/feed";
import { BASE, daysAgo, ensureAuthor, insertPost } from "./fixtures";

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ deps: { now: () => BASE } });
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await ensureAuthor(t);
});

interface ParsedFeed {
  rssVersion?: string;
  channel: Record<string, string>;
  atomSelf?: string;
  items: Array<Record<string, string[]>>;
}

/** Strict XML parse (throws on any well-formedness error). */
function parseFeed(xml: string): ParsedFeed {
  const parser = new SaxesParser({ xmlns: true, position: false });
  const out: ParsedFeed = { channel: {}, items: [] };
  const stack: string[] = [];
  let text = "";
  let current: Record<string, string[]> | null = null;
  parser.on("error", (e) => {
    throw e;
  });
  parser.on("opentag", (tag) => {
    stack.push(tag.local);
    text = "";
    if (tag.local === "rss") out.rssVersion = tag.attributes["version"] ? String((tag.attributes["version"] as { value: string }).value) : undefined;
    if (tag.local === "item") current = {};
    if (tag.local === "link" && tag.uri === "http://www.w3.org/2005/Atom") out.atomSelf = (tag.attributes["href"] as { value: string }).value;
  });
  parser.on("text", (s) => (text += s));
  parser.on("cdata", (s) => (text += s));
  parser.on("closetag", (tag) => {
    stack.pop();
    if (tag.local === "item") {
      out.items.push(current!);
      current = null;
    } else if (current && stack[stack.length - 1] === "item") {
      (current[tag.local] ??= []).push(text);
    } else if (!current && stack[stack.length - 1] === "channel" && tag.uri !== "http://www.w3.org/2005/Atom") {
      out.channel[tag.local] = text;
    }
    text = "";
  });
  parser.write(xml).close();
  return out;
}

describe("GET /feed.xml", () => {
  it("serves valid RSS 2.0 with full HTML content, absolute URLs and correct headers", async () => {
    await insertPost(t, {
      slug: "feed-one",
      title: `Tags & <b>"quotes"</b> ]]> 'apos'`,
      section: "engineering",
      publishedAt: daysAgo(2),
      tags: ["Rust & C++"],
      markdown: `# Heading\n\nBody with [a link](/about) and ![pic](/api/media/files/x.png) and <script>alert(1)</script> and ]]> end.`,
    });
    await insertPost(t, { slug: "feed-two", section: "personal", publishedAt: daysAgo(1), title: "Second" });
    await insertPost(t, { slug: "feed-draft", status: "draft" });

    const res = await request(t.app).get("/api/feed.xml").expect(200);
    expect(res.headers["content-type"]).toMatch(/^application\/rss\+xml/);
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
    const feed = parseFeed(res.text);
    expect(feed.rssVersion).toBe("2.0");
    expect(feed.channel.title).toBe(t.config.siteName);
    expect(feed.channel.link).toBe("http://localhost:3000");
    expect(feed.channel.language).toBe("en");
    expect(new Date(feed.channel.lastBuildDate!).getTime()).not.toBeNaN();
    expect(feed.atomSelf).toBe("http://localhost:3000/feed.xml");
    expect(feed.items).toHaveLength(2);
    expect(feed.items.map((i) => i.link![0])).toEqual(["http://localhost:3000/personal/feed-two", "http://localhost:3000/engineering/feed-one"]);
    const one = feed.items[1]!;
    expect(one.title![0]).toBe(`Tags & <b>"quotes"</b> ]]> 'apos'`);
    expect(one.guid![0]).toBe("http://localhost:3000/engineering/feed-one");
    expect(new Date(one.pubDate![0]!).toISOString()).toBe(daysAgo(2).toISOString());
    expect(one.category).toEqual(expect.arrayContaining(["Engineering", "Rust & C++"]));
    const html = one.encoded![0]!;
    expect(html).toContain("<h1");
    expect(html).toContain('href="http://localhost:3000/about"');
    expect(html).toContain('src="http://localhost:3000/api/media/files/x.png"');
    expect(html).not.toContain("<script>");
  });

  it("filters by section and validates it", async () => {
    await insertPost(t, { slug: "e", section: "engineering" });
    await insertPost(t, { slug: "p", section: "personal" });
    const feed = parseFeed((await request(t.app).get("/api/feed.xml?section=personal").expect(200)).text);
    expect(feed.items.map((i) => i.link![0])).toEqual(["http://localhost:3000/personal/p"]);
    expect(feed.channel.title).toContain("Personal");
    expect(feed.atomSelf).toBe("http://localhost:3000/feed.xml?section=personal");
    await request(t.app).get("/api/feed.xml?section=nope").expect(400);
  });

  it("is valid with no posts", async () => {
    const feed = parseFeed((await request(t.app).get("/api/feed.xml").expect(200)).text);
    expect(feed.items).toEqual([]);
  });
});

describe("xml helpers", () => {
  it("xmlEscape escapes specials and drops illegal control characters", () => {
    expect(xmlEscape(`a&b<c>"d"'e'\u0001\u0008x`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;x");
  });
  it("cdata splits the terminator so the payload round-trips", () => {
    const xml = `<r>${cdata("x ]]> <b>y</b>")}</r>`;
    let text = "";
    const p = new SaxesParser();
    p.on("cdata", (s) => (text += s));
    p.write(xml).close();
    expect(text).toBe("x ]]> <b>y</b>");
  });
  it("buildRss is well-formed even for hostile input", () => {
    const xml = buildRss({
      siteUrl: "https://example.com/",
      siteName: `S&"<>`,
      lastBuildDate: new Date(0),
      items: [{ title: "]]><x/>", slug: "s", section: "personal", excerpt: "<&>", publishedAt: new Date(0).toISOString(), authorName: "<a>", tags: [{ name: "&" }], html: "<p>]]></p>" }],
    });
    expect(() => parseFeed(xml)).not.toThrow();
  });
});
