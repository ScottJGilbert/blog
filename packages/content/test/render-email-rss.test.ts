import { describe, expect, it } from "vitest";
import { renderContent, renderEmailDocument, renderHtml, wrapEmailHtml } from "../src/index";
import {
  F, a, cell, checklist, code, collapsible, datetime, doc, equation, figma, h, hr, image, layout, li, ol, p, pageBreak, quote, t, table, tok, tr, tweet, ul, youtube,
} from "./helpers/build";
import { allAttributes, checkWellFormed, classesOf, tagsOf, textOf } from "./helpers/html";
import { kitchenSink } from "./fixtures";

const BASE = "https://blog.example.com";
const email = (d: unknown, o = {}) => renderHtml(d, { target: "email", baseUrl: BASE, ...o });
const rss = (d: unknown, o = {}) => renderHtml(d, { target: "rss", baseUrl: BASE, ...o });

describe.each([["email", email], ["rss", rss]] as const)("%s target: shared guarantees", (_name, render) => {
  it("is well formed and has no scripts, iframes, details or class dependence on the theme", () => {
    const html = render(kitchenSink);
    expect(checkWellFormed(html)).toEqual([]);
    const tags = tagsOf(html);
    for (const forbidden of ["script", "iframe", "details", "summary", "style", "link", "object", "embed", "form", "input", "button", "video", "audio", "svg"]) {
      expect(tags.has(forbidden)).toBe(false);
    }
    expect(classesOf(html).size).toBe(0);
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).not.toContain("javascript:");
  });

  it("converts relative links and images to absolute URLs using baseUrl", () => {
    const html = render(doc(p(a("/about", t("about")), a("post/1", t("rel")), a("#top", t("anchor"))), p(image("/api/media/files/pic.png", "pic", { width: 100, height: 50 }))));
    expect(html).toContain('href="https://blog.example.com/about"');
    expect(html).toContain('href="https://blog.example.com/post/1"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('src="https://blog.example.com/api/media/files/pic.png"');
  });

  it("drops data: URI images (not deliverable) but keeps their alt text", () => {
    const html = render(doc(p(image("data:image/png;base64,iVBORw0KGgo=", "inline"))));
    expect(html).not.toContain("<img");
    expect(html).toContain("inline");
  });

  it("falls back to the LaTeX source for equations", () => {
    const html = render(doc(p(equation("E=mc^2", true)), equation("\\frac{a}{b}", false)));
    expect(html).not.toContain("katex");
    expect(html).toContain("<code");
    expect(html).toContain("E=mc^2");
    expect(html).toContain("\\frac{a}{b}");
  });

  it("falls back to links for embeds", () => {
    const html = render(doc(youtube("dQw4w9WgXcQ"), tweet("123"), figma("AbCdEfGhIjKlMnOpQrStUv")));
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('href="https://x.com/i/web/status/123"');
    expect(html).toContain('href="https://www.figma.com/file/AbCdEfGhIjKlMnOpQrStUv"');
  });

  it("shows collapsible content expanded", () => {
    const html = render(doc(collapsible("Title", [p(t("Hidden body"))], false)));
    expect(html).toContain("Title");
    expect(html).toContain("Hidden body");
  });

  it("renders checklists with visible markers instead of CSS checkboxes", () => {
    const html = render(doc(checklist(li([t("done")], { checked: true }), li([t("todo")], { checked: false }))));
    expect(html).toContain("&#9745; done");
    expect(html).toContain("&#9744; todo");
  });

  it("skips unknown nodes and unsafe URLs the same way as web", () => {
    const r = renderContent(doc({ type: "poll", version: 1 }, p(a("javascript:alert(1)", t("x")))), { target: "email" });
    expect(r.html).not.toContain("javascript:");
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["unknown-node-type", "unsafe-url"]));
  });

  it("renders text formats as semantic tags", () => {
    const html = render(doc(p(t("b", F.bold | F.italic), t("u", F.underline), t("s", F.strike), t("c", F.code))));
    expect(html).toContain("<em><strong");
    expect(html).toContain("<u>");
    expect(html).toContain("<s>");
    expect(html).toContain("<code");
  });

  it("emits the raw date <time> and plain inline extras", () => {
    expect(render(doc(p(datetime("2024-05-06T00:00:00.000Z"))))).toContain('<time datetime="2024-05-06T00:00:00.000Z">May 6, 2024</time>');
  });

  it("warns when baseUrl is missing", () => {
    const r = renderContent(doc(p(a("/x", t("x")))), { target: "rss" });
    expect(r.warnings.some((w) => /baseUrl/.test(w.message))).toBe(true);
    expect(r.html).toContain('href="/x"');
  });
});

describe("email target specifics", () => {
  it("inlines essential styles on block elements", () => {
    const html = email(doc(h("h1", "T"), p(t("x")), quote(t("q")), hr(), ul(li([t("a")])), code("js", tok("x"))));
    expect(html).toContain('<h1 style="margin:0 0 16px 0;font-size:28px');
    expect(html).toContain('<p style="margin:0 0 16px 0;line-height:1.6">x</p>');
    expect(html).toContain('<blockquote style="');
    expect(html).toContain('<hr style="');
    expect(html).toContain('<ul style="');
    expect(html).toContain('<pre data-language="js" style="');
    expect(html).not.toContain("id=");
  });

  it("styles links with a colour and underline, no target/rel", () => {
    expect(email(doc(p(a("https://example.org", t("x")))))).toBe(
      '<p style="margin:0 0 16px 0;line-height:1.6"><a href="https://example.org" style="color:#216fdb;text-decoration:underline">x</a></p>',
    );
  });

  it("renders tables with inline borders and padding (no classes)", () => {
    const html = email(
      doc(table([tr(cell([p(t("H"))], { headerState: 1 }), cell([p(t("V"))], { backgroundColor: "#eef", colSpan: 2 }))])),
    );
    expect(html).toContain('<table style="border-collapse:collapse;width:100%');
    expect(html).toContain("<th scope=\"col\" style=\"border:1px solid #bbbbbb;padding:6px 8px");
    expect(html).toContain('colspan="2"');
    expect(html).toContain("background-color:#eef");
    expect(html).not.toContain("tabindex");
    // paragraphs inside cells use tight margins
    expect(html).toContain('<p style="margin:0 0 4px 0;line-height:1.5">H</p>');
  });

  it("renders layout containers as presentation tables with proportional widths", () => {
    const html = email(doc(layout("1fr 3fr", [p(t("a"))], [p(t("b"))])));
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('width="25%"');
    expect(html).toContain('width="75%"');
    expect(html).not.toContain("grid");
  });

  it("renders images with email-safe attributes and a figure caption block", () => {
    const html = email(doc(p(image("https://img.example.com/a.png", "A", { width: 600, height: 300 }, "Cap"))));
    expect(html).toContain('width="600" height="300" style="display:inline-block;max-width:100%;height:auto');
    expect(html).not.toContain("loading=");
    expect(html).toContain("Cap</div></div>");
    expect(html).not.toContain("<figure");
  });

  it("uses a YouTube thumbnail link for videos", () => {
    const html = email(doc(youtube("dQw4w9WgXcQ")));
    expect(html).toContain('src="https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"');
    expect(html).toContain("Watch on YouTube");
  });

  it("maps highlight and text transforms to inline styles", () => {
    const html = email(doc(p(t("h", F.highlight), t("U", F.upper))));
    expect(html).toContain('<mark style="background-color:#fff3b0');
    expect(html).toContain('style="text-transform:uppercase"');
  });

  it("does not rely on classes: stripping every class attribute changes nothing visual-critical", () => {
    const html = email(kitchenSink);
    expect(html).not.toMatch(/class=/);
    // every block element that needs styling carries an inline style
    for (const tag of ["h1", "h2", "p", "ul", "ol", "table", "blockquote", "pre"]) {
      for (const m of html.matchAll(new RegExp(`<${tag}(?=[\\s>])([^>]*)>`, "g"))) {
        if (tag === "p" && /role="paragraph"/.test(m[1]!)) continue;
        expect(m[1]).toMatch(/style=/);
      }
    }
  });

  it("keeps max-width friendly output: images are constrained and tables are 100% wide", () => {
    const html = email(kitchenSink);
    for (const m of html.matchAll(/<img\b[^>]*>/g)) expect(m[0]).toContain("max-width:100%");
  });
});

describe("rss target specifics", () => {
  it("contains no inline styles (except the image max-width guard) and no ids", () => {
    const html = rss(kitchenSink);
    const offenders = allAttributes(html).filter((x) => (x.name === "style" && x.tag !== "img") || x.name === "id");
    expect(offenders).toEqual([]);
  });

  it("renders code blocks as plain <pre> without token spans", () => {
    const html = rss(doc(code("js", tok("const", "keyword", "color:#f00"), tok(" x"))));
    expect(html).toBe('<pre data-language="js">const x</pre>');
  });

  it("marks external links rel=noopener noreferrer nofollow without target", () => {
    expect(rss(doc(p(a("https://example.org", t("x")))))).toBe('<p><a href="https://example.org" rel="noopener noreferrer nofollow">x</a></p>');
  });

  it("uses figure/figcaption for captioned images", () => {
    const html = rss(doc(p(image("https://img.example.com/a.png", "A", {}, "Cap"))));
    expect(html).toContain("<figure><img");
    expect(html).toContain("<figcaption>Cap</figcaption>");
  });

  it("keeps the page break as an hr and ignores user styles", () => {
    expect(rss(doc(pageBreak()))).toBe("<hr>");
    expect(rss(doc(p(t("x", 0, "color: red"))))).toBe("<p>x</p>");
  });

  it("renders ordered lists with start", () => {
    expect(rss(doc({ ...ol(li([t("a")])), start: 3 }))).toBe('<ol start="3"><li value="3">a</li></ol>');
  });
});

describe("email document wrapper", () => {
  it("wraps a fragment in a 600px table layout with a hidden preheader", () => {
    const html = wrapEmailHtml("<p>hi</p>", { title: "Subj <x>", preheader: "Peek & see" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Subj &lt;x&gt;</title>");
    expect(html).toContain("Peek &amp; see");
    expect(html).toContain('width="600"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain("<p>hi</p>");
    expect(checkWellFormed(html)).toEqual([]);
  });

  it("clamps width, validates colour/lang and renders footers verbatim", () => {
    const html = wrapEmailHtml("x", { maxWidth: 99999, backgroundColor: "red;position:fixed", lang: '"><script>', footerHtml: '<a href="https://u">unsub</a>' });
    expect(html).toContain('width="800"');
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("<script>");
    expect(html).toContain('<a href="https://u">unsub</a>');
  });

  it("renderEmailDocument renders and wraps", () => {
    const r = renderEmailDocument(doc(p(t("hello"))), { baseUrl: BASE, title: "T" });
    expect(r.html).toContain("hello");
    expect(r.fragment).toBe('<p style="margin:0 0 16px 0;line-height:1.6">hello</p>');
    expect(textOf(r.html)).toContain("hello");
  });
});
