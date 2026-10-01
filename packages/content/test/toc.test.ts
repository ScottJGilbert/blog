import { describe, expect, it } from "vitest";
import { extractToc, parseContent, renderHtml, slugify } from "../src/index";
import { a, collapsible, doc, el, F, h, layout, p, t, table, cell, tr } from "./helpers/build";
import { kitchenSink } from "./fixtures";

describe("slugify", () => {
  it.each([
    ["Hello World", "hello-world"],
    ["  Spaces   everywhere  ", "spaces-everywhere"],
    ["Café déjà vu", "cafe-deja-vu"],
    ["C++ & Rust: friends?", "c-and-rust-friends"],
    ["What's new in v2.0", "whats-new-in-v2-0"],
    ["日本語", "section"],
    ["", "section"],
    ["---", "section"],
    ["UPPER_snake_Case", "upper-snake-case"],
    ["emoji 🎉 time", "emoji-time"],
  ])("%j -> %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates long text without trailing dashes", () => {
    const s = slugify("word ".repeat(60));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });

  it("supports a custom fallback", () => {
    expect(slugify("!!!", "x")).toBe("x");
  });
});

describe("extractToc", () => {
  it("returns id/text/level in document order", () => {
    const toc = extractToc(doc(h("h1", "Title"), p(t("x")), h("h2", "Part One"), h("h3", "Detail"), h("h2", "Part Two")));
    expect(toc).toEqual([
      { id: "title", text: "Title", level: 1 },
      { id: "part-one", text: "Part One", level: 2 },
      { id: "detail", text: "Detail", level: 3 },
      { id: "part-two", text: "Part Two", level: 2 },
    ]);
  });

  it("de-duplicates ids deterministically", () => {
    const toc = extractToc(doc(h("h2", "Intro"), h("h2", "Intro"), h("h3", "Intro"), h("h2", "Intro 2"), h("h2", "Intro")));
    expect(toc.map((x) => x.id)).toEqual(["intro", "intro-2", "intro-3", "intro-2-2", "intro-4"]);
    expect(new Set(toc.map((x) => x.id)).size).toBe(toc.length);
  });

  it("uses the plain text of formatted/linked headings", () => {
    const toc = extractToc(doc(el("heading", [t("Bold ", F.bold), a("https://e.org", t("link")), t(" text")], { tag: "h2" })));
    expect(toc).toEqual([{ id: "bold-link-text", text: "Bold link text", level: 2 }]);
  });

  it("includes headings nested in layouts, collapsibles and table cells; skips empty headings", () => {
    const toc = extractToc(
      doc(
        h("h2", "Top"),
        layout("1fr 1fr", [h("h3", "In layout")], [p(t("x"))]),
        collapsible("c", [h("h3", "In collapsible")]),
        table([tr(cell([h("h4", "In cell")]))]),
        h("h2", ""),
        h("h2", "   "),
      ),
    );
    expect(toc.map((x) => x.text)).toEqual(["Top", "In layout", "In collapsible", "In cell"]);
  });

  it("accepts raw JSON, JSON strings and parsed content, with the same result", () => {
    const raw = kitchenSink;
    const a1 = extractToc(raw);
    expect(extractToc(JSON.stringify(raw))).toEqual(a1);
    expect(extractToc(parseContent(raw).content)).toEqual(a1);
    expect(a1.length).toBeGreaterThan(5);
  });

  it("returns [] for unusable input", () => {
    expect(extractToc(null)).toEqual([]);
    expect(extractToc({ root: 1 })).toEqual([]);
  });

  it("honours idPrefix", () => {
    expect(extractToc(doc(h("h2", "A")), { idPrefix: "h-" })).toEqual([{ id: "h-a", text: "A", level: 2 }]);
  });
});

describe("TOC ids match the ids renderHtml puts on headings", () => {
  const idsInHtml = (html: string) => [...html.matchAll(/<h([1-6])\b[^>]*\bid="([^"]*)"[^>]*>/g)].map((m) => ({ level: Number(m[1]), id: m[2]! }));

  it("for the kitchen sink", () => {
    const toc = extractToc(kitchenSink);
    const ids = idsInHtml(renderHtml(kitchenSink, { target: "web" }));
    expect(ids.map((x) => x.id)).toEqual(toc.map((x) => x.id));
    expect(ids.map((x) => x.level)).toEqual(toc.map((x) => x.level));
  });

  it("with duplicates, nesting and prefixes", () => {
    const d = doc(
      h("h2", "Same"),
      layout("1fr", [h("h2", "Same"), h("h3", "Same")]),
      collapsible("x", [h("h2", "Same")]),
      h("h2", "Other"),
    );
    for (const idPrefix of ["", "sec-"]) {
      const toc = extractToc(d, { idPrefix });
      const ids = idsInHtml(renderHtml(d, { headingIdPrefix: idPrefix }));
      expect(ids.map((x) => x.id)).toEqual(toc.map((x) => x.id));
    }
  });

  it("when empty headings sit between others (they consume ids but are not in the TOC)", () => {
    const d = doc(h("h2", "A"), h("h2", ""), h("h2", "A"));
    const toc = extractToc(d);
    const html = renderHtml(d);
    for (const entry of toc) expect(html).toContain(`id="${entry.id}"`);
  });

  it("every TOC id is unique in the rendered page and is a valid fragment id", () => {
    const toc = extractToc(kitchenSink);
    for (const e of toc) expect(e.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    const html = renderHtml(kitchenSink);
    for (const e of toc) expect(html.split(`id="${e.id}"`).length - 1).toBe(1);
  });

  it("email and rss targets omit ids (anchors are meaningless there)", () => {
    expect(renderHtml(kitchenSink, { target: "email" })).not.toContain(" id=");
    expect(renderHtml(kitchenSink, { target: "rss" })).not.toContain(" id=");
  });
});
