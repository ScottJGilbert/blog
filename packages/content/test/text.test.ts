import { describe, expect, it } from "vitest";
import { countWords, extractImages, isContentEmpty, parseContent, readingMinutes, toExcerpt, toPlainText } from "../src/index";
import {
  F, a, br, cell, checklist, code, collapsible, datetime, doc, emoji, equation, figma, h, hr, image, layout, li, mark, ol, p, pageBreak, quote, t, tab, table, tok, tr, tweet, ul, youtube,
} from "./helpers/build";
import { kitchenSink } from "./fixtures";

describe("toPlainText", () => {
  it("separates blocks with a blank line", () => {
    expect(toPlainText(doc(h("h1", "Title"), p(t("One")), quote(t("Quote")), p(t("Two"))))).toBe("Title\n\nOne\n\nQuote\n\nTwo");
  });

  it("flattens inline formatting, links, marks, line breaks and tabs", () => {
    expect(toPlainText(doc(p(t("a ", F.bold), a("https://e.org", t("link")), t(" "), mark(["1"], t("m")), br(), tab(), t("z"))))).toBe("a link m\n\tz");
  });

  it("puts list items on single lines (nested too) and can add markers", () => {
    const d = doc(ul(li([t("a")]), li([ul(li([t("nested")]))]), li([t("b")])), ol(li([t("x")]), li([t("y")])), checklist(li([t("done")], { checked: true }), li([t("todo")], { checked: false })));
    expect(toPlainText(d)).toBe("a\nnested\nb\n\nx\ny\n\ndone\ntodo");
    expect(toPlainText(d, { markers: true })).toBe("- a\n  - nested\n- b\n\n1. x\n2. y\n\n[x] done\n[ ] todo");
  });

  it("renders table rows on lines with cells separated by ' | '", () => {
    const d = doc(table([tr(cell([p(t("A"))]), cell([p(t("B"))])), tr(cell([p(t("1"))]), cell([p(t("2")), p(t("3"))]))]));
    expect(toPlainText(d)).toBe("A | B\n1 | 2 3");
  });

  it("includes code text verbatim, equations as LaTeX, image alt and captions, date-times", () => {
    const d = doc(
      code("js", tok("const x"), br(), tab(), tok("= 1;")),
      equation("E=mc^2", false),
      p(image("https://i/x.png", "A chart", {}, "Figure 1")),
      p(t("On "), datetime("2024-05-06T07:08:00.000Z"), t(" we "), equation("x", true), t(" "), emoji("🙂")),
    );
    expect(toPlainText(d)).toBe("const x\n\t= 1;\n\nE=mc^2\n\nA chart\n\nFigure 1\n\nOn May 6, 2024 07:08 UTC we x 🙂");
  });

  it("skips decorative nodes, embeds and unknown nodes (embed URLs on request)", () => {
    const d = doc(p(t("a")), hr(), pageBreak(), youtube("dQw4w9WgXcQ"), tweet("123"), figma("AbCdEfGhIjKlMnOpQrStUv"), { type: "poll", version: 1, question: "secret?" }, p(t("b")));
    expect(toPlainText(d)).toBe("a\n\nb");
    expect(toPlainText(d, { embedUrls: true })).toBe(
      "a\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nhttps://x.com/i/web/status/123\n\nhttps://www.figma.com/file/AbCdEfGhIjKlMnOpQrStUv\n\nb",
    );
  });

  it("reads layouts and collapsibles in order", () => {
    expect(toPlainText(doc(layout("1fr 1fr", [p(t("left"))], [p(t("right"))]), collapsible("Q?", [p(t("A."))])))).toBe("left\n\nright\n\nQ?\n\nA.");
  });

  it("drops empty blocks and trims", () => {
    expect(toPlainText(doc(p(), p(t("  x  ")), p(t(" ")), p()))).toBe("x");
    expect(toPlainText(null)).toBe("");
  });

  it("works on the kitchen sink", () => {
    const text = toPlainText(kitchenSink);
    expect(text).toContain("Building a Blog Platform");
    expect(text).toContain("Figure 1: a chart");
    expect(text).toContain("Name | Value");
    expect(text).not.toContain("<");
    expect(text).not.toContain("undefined");
  });
});

describe("toExcerpt", () => {
  const long = "The quick brown fox jumps over the lazy dog. ".repeat(20);

  it("returns short text unchanged", () => {
    expect(toExcerpt(doc(p(t("Short and sweet."))))).toBe("Short and sweet.");
  });

  it("cuts on a word boundary and adds an ellipsis, never exceeding maxChars", () => {
    const ex = toExcerpt(doc(p(t(long))), 100);
    expect(ex.endsWith("…")).toBe(true);
    expect(Array.from(ex).length).toBeLessThanOrEqual(100);
    expect(ex.slice(0, -1)).toMatch(/\w$/);
    // every word before the ellipsis is a complete word of the source
    for (const w of ex.slice(0, -1).split(" ")) expect(["The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog."]).toContain(w);
  });

  it("defaults to 200 chars", () => {
    const ex = toExcerpt(doc(p(t(long))));
    expect(Array.from(ex).length).toBeLessThanOrEqual(200);
    expect(ex.endsWith("…")).toBe(true);
  });

  it("skips headings when there is body text, collapses whitespace and merges paragraphs", () => {
    expect(toExcerpt(doc(h("h1", "Heading"), p(t("First   paragraph.")), p(t("Second\nparagraph."))))).toBe("First paragraph. Second paragraph.");
  });

  it("falls back to headings when they are the only text", () => {
    expect(toExcerpt(doc(h("h1", "Only a heading")))).toBe("Only a heading");
  });

  it("handles words longer than the budget and tiny limits", () => {
    const ex = toExcerpt(doc(p(t("Supercalifragilisticexpialidocious is long"))), 10);
    expect(Array.from(ex).length).toBeLessThanOrEqual(10);
    expect(ex.endsWith("…")).toBe(true);
    expect(toExcerpt(doc(p(t("abc def"))), 1)).toBe("…");
    expect(toExcerpt(doc(p(t("abc"))), 3)).toBe("abc");
  });

  it("does not split surrogate pairs", () => {
    const ex = toExcerpt(doc(p(t("😀".repeat(50)))), 11);
    expect(Array.from(ex)).toHaveLength(11);
    expect(ex).toBe("😀".repeat(10) + "…");
  });

  it("strips trailing punctuation before the ellipsis", () => {
    expect(toExcerpt(doc(p(t("Hello, world, and everyone else here"))), 20)).toBe("Hello, world, and…");
  });

  it("returns '' for empty content", () => {
    expect(toExcerpt(doc(p()))).toBe("");
    expect(toExcerpt(undefined)).toBe("");
  });
});

describe("readingMinutes / countWords", () => {
  const words = (n: number) => doc(p(t(Array.from({ length: n }, (_, i) => `word${i}`).join(" "))));

  it("is at least 1 minute", () => {
    expect(readingMinutes(doc(p()))).toBe(1);
    expect(readingMinutes(null)).toBe(1);
    expect(readingMinutes(words(5))).toBe(1);
  });

  it("rounds up using wpm=220 by default", () => {
    expect(readingMinutes(words(220))).toBe(1);
    expect(readingMinutes(words(221))).toBe(2);
    expect(readingMinutes(words(1100))).toBe(5);
  });

  it("accepts a custom wpm and guards against nonsense", () => {
    expect(readingMinutes(words(400), 100)).toBe(4);
    expect(readingMinutes(words(440), 0)).toBe(2);
    expect(readingMinutes(words(440), Number.NaN)).toBe(2);
  });

  it("counts words, not markup or punctuation", () => {
    expect(countWords("Hello, world! It's a well-known fact — 42 times.")).toBe(8);
    expect(countWords("")).toBe(0);
    expect(countWords("... --- ,,,")).toBe(0);
  });

  it("counts CJK characters as half a word each", () => {
    expect(countWords("日本語のテキスト")).toBe(4);
  });
});

describe("isContentEmpty", () => {
  it("is true for blank documents and whitespace-only text", () => {
    expect(isContentEmpty(doc(p()))).toBe(true);
    expect(isContentEmpty(doc(p(t("   ")), p()))).toBe(true);
    expect(isContentEmpty(null)).toBe(true);
  });
  it("is false with text, media or embeds", () => {
    expect(isContentEmpty(doc(p(t("x"))))).toBe(false);
    expect(isContentEmpty(doc(p(image("https://a/b.png", ""))))).toBe(false);
    expect(isContentEmpty(doc(youtube("dQw4w9WgXcQ")))).toBe(false);
    expect(isContentEmpty(doc(equation("x", false)))).toBe(false);
    expect(isContentEmpty(kitchenSink)).toBe(false);
  });
});

describe("extractImages", () => {
  it("lists images in document order with alt, size and caption", () => {
    const imgs = extractImages(
      doc(p(image("https://a/1.png", "one", { width: 10, height: 20 })), layout("1fr", [p(image("https://a/2.png", "two", {}, "cap two"))])),
    );
    expect(imgs).toEqual([
      { src: "https://a/1.png", alt: "one", width: 10, height: 20, caption: "" },
      { src: "https://a/2.png", alt: "two", width: 0, height: 0, caption: "cap two" },
    ]);
  });
  it("accepts parsed content too", () => {
    expect(extractImages(parseContent(kitchenSink).content)).toHaveLength(2);
  });
});
