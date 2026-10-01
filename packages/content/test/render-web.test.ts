import { describe, expect, it } from "vitest";
import { renderContent, renderHtml } from "../src/index";
import {
  F, a, auto, br, cell, checklist, code, collapsible, datetime, doc, el, emoji, equation, figma, h, hashtag, hr, image, keyword, layout,
  li, mark, mention, ol, overflow, p, pageBreak, quote, special, t, tab, table, tok, tr, tweet, ul, youtube,
} from "./helpers/build";
import { checkWellFormed, classesOf, textOf } from "./helpers/html";
import { kitchenSink } from "./fixtures";

const web = (d: unknown, o: Parameters<typeof renderHtml>[1] = {}) => renderHtml(d, { target: "web", ...o });

describe("web: structure & robustness", () => {
  it("renders the kitchen sink as well-formed HTML", () => {
    const html = web(kitchenSink);
    expect(checkWellFormed(html)).toEqual([]);
    expect(html.length).toBeGreaterThan(1000);
  });

  it("is deterministic", () => {
    expect(web(kitchenSink)).toBe(web(kitchenSink));
  });

  it("never throws on garbage and returns empty string", () => {
    for (const input of [undefined, null, 1, "x", [], {}, { root: 3 }, "{"]) {
      expect(web(input)).toBe("");
    }
  });

  it("accepts a JSON string", () => {
    expect(web(JSON.stringify(doc(p(t("hi")))))).toBe('<p class="ViewerTheme__paragraph">hi</p>');
  });

  it("wraps stray inline nodes at the root in an implicit paragraph", () => {
    expect(web(doc(t("loose "), t("text", F.bold)))).toBe('<p class="ViewerTheme__paragraph">loose <strong class="ViewerTheme__textBold">text</strong></p>');
  });

  it("is okay with the default target (web) and exposes warnings through renderContent", () => {
    const r = renderContent(doc({ type: "mystery", version: 1 }, p(t("x"))));
    expect(r.html).toBe('<p class="ViewerTheme__paragraph">x</p>');
    expect(r.warnings.map((w) => w.code)).toContain("unknown-node-type");
  });

  it("calls onWarning for each distinct issue", () => {
    const seen: string[] = [];
    renderHtml(doc({ type: "mystery", version: 1 }, p(a("javascript:alert(1)", t("x")))), { onWarning: (w) => seen.push(w.code) });
    expect(seen).toContain("unknown-node-type");
    expect(seen).toContain("unsafe-url");
  });
});

describe("web: paragraphs, headings, quotes", () => {
  it("renders paragraph / empty paragraph / alignment / indent / rtl", () => {
    expect(web(doc(p()))).toBe('<p class="ViewerTheme__paragraph"><br></p>');
    expect(web(doc(el("paragraph", [t("x")], { format: "center", indent: 2 })))).toBe(
      '<p class="ViewerTheme__paragraph" style="text-align:center;padding-inline-start:80px">x</p>',
    );
    expect(web(doc(el("paragraph", [t("x")], { direction: "rtl" })))).toBe('<p class="ViewerTheme__paragraph" dir="rtl">x</p>');
    // left/start are the default and add nothing; absurd indents are capped
    expect(web(doc(el("paragraph", [t("x")], { format: "left", indent: 1000 })))).toContain("padding-inline-start:800px");
  });

  it("renders headings with theme classes and ids", () => {
    const html = web(doc(h("h1", "Hello World"), h("h4", "Four"), el("heading", [t("Aligned")], { tag: "h3", format: "right" })));
    expect(html).toContain('<h1 id="hello-world" class="ViewerTheme__h1">Hello World</h1>');
    expect(html).toContain('<h4 id="four" class="ViewerTheme__h4">Four</h4>');
    expect(html).toContain('<h3 id="aligned" class="ViewerTheme__h3" style="text-align:right">Aligned</h3>');
  });

  it("applies headingIdPrefix", () => {
    expect(web(doc(h("h2", "Intro")), { headingIdPrefix: "s-" })).toContain('id="s-intro"');
  });

  it("renders quotes", () => {
    expect(web(doc(quote(t("wise"))))).toBe('<blockquote class="ViewerTheme__quote">wise</blockquote>');
  });
});

describe("web: text formats", () => {
  const one = (format: number, style = "") => web(doc(p(t("x", format, style))));
  const wrap = (inner: string) => `<p class="ViewerTheme__paragraph">${inner}</p>`;

  it("plain text has no wrapper", () => {
    expect(one(0)).toBe(wrap("x"));
  });

  it.each([
    [F.bold, '<strong class="ViewerTheme__textBold">x</strong>'],
    [F.italic, '<em class="ViewerTheme__textItalic">x</em>'],
    [F.underline, '<u class="ViewerTheme__textUnderline">x</u>'],
    [F.strike, '<s class="ViewerTheme__textStrikethrough">x</s>'],
    [F.code, '<code class="ViewerTheme__textCode">x</code>'],
    [F.sub, '<sub class="ViewerTheme__textSubscript">x</sub>'],
    [F.sup, '<sup class="ViewerTheme__textSuperscript">x</sup>'],
    [F.highlight, '<mark class="ViewerTheme__textHighlight">x</mark>'],
    [F.lower, '<span class="ViewerTheme__textLowercase">x</span>'],
    [F.upper, '<span class="ViewerTheme__textUppercase">x</span>'],
    [F.cap, '<span class="ViewerTheme__textCapitalize">x</span>'],
  ])("format bit %i", (format, expected) => {
    expect(one(format)).toBe(wrap(expected));
  });

  it("nests combinations in a stable order and puts theme classes on the innermost element", () => {
    expect(one(F.bold | F.italic)).toBe(wrap('<em><strong class="ViewerTheme__textBold ViewerTheme__textItalic">x</strong></em>'));
    expect(one(F.underline | F.strike)).toBe(wrap('<s><u class="ViewerTheme__textUnderlineStrikethrough">x</u></s>'));
    const all = one(F.bold | F.italic | F.underline | F.strike | F.code | F.highlight | F.sup);
    expect(all).toBe(
      wrap(
        '<mark><sup><s><u><em><strong><code class="ViewerTheme__textBold ViewerTheme__textItalic ViewerTheme__textUnderlineStrikethrough ViewerTheme__textCode ViewerTheme__textHighlight ViewerTheme__textSuperscript">x</code></strong></em></u></s></sup></mark>',
      ),
    );
    // order is independent of which bits are set first
    expect(one(F.code | F.bold)).toBe(wrap('<strong><code class="ViewerTheme__textBold ViewerTheme__textCode">x</code></strong>'));
  });

  it("ignores unknown high format bits", () => {
    expect(one(1 << 15)).toBe(wrap("x"));
    expect(one((1 << 15) | F.bold)).toBe(one(F.bold));
  });

  it("applies allowlisted styles only", () => {
    expect(one(0, "color: #ff0000; font-size: 20px; background-color: rgb(255, 255, 0); font-family: Arial, sans-serif; text-align: center")).toBe(
      wrap('<span style="color:#ff0000;background-color:rgb(255, 255, 0);font-size:20px;font-family:&#39;Arial&#39;, sans-serif;text-align:center">x</span>'),
    );
    expect(one(F.bold, "color: red")).toBe(wrap('<strong class="ViewerTheme__textBold" style="color:red">x</strong>'));
  });

  it("drops disallowed properties and invalid values, with warnings", () => {
    const r = renderContent(doc(p(t("x", 0, "position: fixed; color: expression(alert(1)); background-color: url(javascript:alert(1)); font-size: 9999px; color: blue"))));
    expect(r.html).toBe('<p class="ViewerTheme__paragraph"><span style="color:blue">x</span></p>');
    expect(r.warnings.some((w) => w.code === "unsafe-style")).toBe(true);
  });

  it("renders no empty wrappers for empty text", () => {
    expect(web(doc(p(t("", F.bold))))).toBe('<p class="ViewerTheme__paragraph"><br></p>');
  });

  it("keeps runs of spaces visible and converts tabs/newlines in text", () => {
    expect(one(0).includes("x")).toBe(true);
    expect(web(doc(p(t("a  b   c"))))).toBe('<p class="ViewerTheme__paragraph">a&nbsp; b&nbsp;&nbsp; c</p>');
    expect(web(doc(p(t("a\nb"))))).toBe('<p class="ViewerTheme__paragraph">a<br>b</p>');
  });

  it("renders line breaks and tabs", () => {
    expect(web(doc(p(t("a"), br(), tab(), t("b"))))).toBe(
      '<p class="ViewerTheme__paragraph">a<br><span class="ViewerTheme__tabNode" style="white-space:pre">\t</span>b</p>',
    );
  });
});

describe("web: inline special nodes", () => {
  it("renders hashtag, keyword, specialText, emoji, mention", () => {
    const html = web(doc(p(hashtag("#tag"), t(" "), keyword("kw"), t(" "), special("[s]"), t(" "), emoji("🙂"), t(" "), mention("Ann"))));
    expect(html).toContain('<span class="ViewerTheme__hashtag">#tag</span>');
    expect(html).toContain('<span class="keyword">kw</span>');
    expect(html).toContain('<span class="ViewerTheme__specialText">[s]</span>');
    expect(html).toContain('<span class="bcf-emoji">🙂</span>');
    expect(html).toContain('<span class="bcf-mention" data-mention="Ann">Ann</span>');
  });

  it("makes mark and overflow transparent", () => {
    expect(web(doc(p(mark(["a"], t("m")), overflow(t("o")))))).toBe('<p class="ViewerTheme__paragraph">mo</p>');
  });

  it("renders date-time as <time> (UTC, deterministic)", () => {
    expect(web(doc(p(datetime("2024-05-06T07:08:00.000Z"))))).toBe(
      '<p class="ViewerTheme__paragraph"><time class="bcf-datetime" datetime="2024-05-06T07:08:00.000Z">May 6, 2024 07:08 UTC</time></p>',
    );
    expect(web(doc(p(datetime("2024-05-06T00:00:00.000Z"))))).toContain(">May 6, 2024</time>");
  });
});

describe("web: links", () => {
  it("marks external links with target=_blank and rel", () => {
    expect(web(doc(p(a("https://example.org/x?a=1&b=2", t("go")))))).toBe(
      '<p class="ViewerTheme__paragraph"><a href="https://example.org/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow" class="ViewerTheme__link">go</a></p>',
    );
  });

  it("does not add target/rel to internal links, anchors, mailto and tel", () => {
    for (const url of ["/about", "relative/page", "./x", "../y", "#section", "?page=2", "mailto:me@example.com", "tel:+15551234567"]) {
      const html = web(doc(p(a(url, t("x")))));
      expect(html).toContain(`href="${url}"`);
      expect(html).not.toContain("target=");
      expect(html).not.toContain("rel=");
    }
  });

  it("treats same-origin absolute URLs as internal when baseUrl is given", () => {
    const html = web(doc(p(a("https://blog.example.com/post", t("x")))), { baseUrl: "https://blog.example.com" });
    expect(html).not.toContain("target=");
    const ext = web(doc(p(a("https://other.example.com/post", t("x")))), { baseUrl: "https://blog.example.com" });
    expect(ext).toContain('target="_blank"');
  });

  it("upgrades bare www. and protocol-relative URLs to https (as external)", () => {
    expect(web(doc(p(a("www.example.com/p", t("x")))))).toContain('href="https://www.example.com/p" target="_blank"');
    expect(web(doc(p(a("//cdn.example.com/p", t("x")))))).toContain('href="https://cdn.example.com/p"');
  });

  it("renders title and autolinks; unlinked autolinks become text", () => {
    expect(web(doc(p({ ...a("https://e.org", t("x")), title: 'a "quoted" title' })))).toContain('title="a &quot;quoted&quot; title"');
    expect(web(doc(p(auto("https://auto.example.com"))))).toContain('<a href="https://auto.example.com"');
    expect(web(doc(p({ ...auto("https://auto.example.com"), isUnlinked: true })))).toBe(
      '<p class="ViewerTheme__paragraph">https://auto.example.com</p>',
    );
  });

  it("falls back to text for links without safe URLs and omits empty links", () => {
    expect(web(doc(p(a("javascript:alert(1)", t("click"))))) ).toBe('<p class="ViewerTheme__paragraph">click</p>');
    expect(web(doc(p(a("https://e.org"))))).toBe('<p class="ViewerTheme__paragraph"></p>'.replace("></p>", "><br></p>"));
  });

  it("encodes spaces in hrefs", () => {
    expect(web(doc(p(a("/my page", t("x")))))).toContain('href="/my%20page"');
  });
});

describe("web: lists", () => {
  it("renders bullet lists with theme classes", () => {
    expect(web(doc(ul(li([t("a")]), li([t("b")]))))).toBe(
      '<ul class="ViewerTheme__ul"><li class="ViewerTheme__listItem">a</li><li class="ViewerTheme__listItem">b</li></ul>',
    );
  });

  it("renders ordered lists with depth classes, values and start", () => {
    const html = web(doc(ol(li([t("a")]), li([ol(li([t("n")]))]), li([t("b")]))));
    expect(html).toContain('<ol class="ViewerTheme__ol1">');
    expect(html).toContain('<li class="ViewerTheme__listItem" value="1">a</li>');
    expect(html).toContain('<li class="ViewerTheme__listItem ViewerTheme__nestedListItem"><ol class="ViewerTheme__ol2"><li class="ViewerTheme__listItem" value="1">n</li></ol></li>');
    // the nested wrapper does not consume a number: "b" is item 2
    expect(html).toContain('<li class="ViewerTheme__listItem" value="2">b</li>');
    expect(web(doc({ ...ol(li([t("a")])), start: 5 }))).toContain('<ol class="ViewerTheme__ol1" start="5">');
  });

  it("caps ol depth class at 5", () => {
    let list: any = ol(li([t("deep")]));
    for (let i = 0; i < 7; i++) list = ol(li([list]));
    const classes = classesOf(web(doc(list)));
    expect([...classes].filter((c) => c.startsWith("ViewerTheme__ol")).sort()).toEqual(["ViewerTheme__ol1", "ViewerTheme__ol2", "ViewerTheme__ol3", "ViewerTheme__ol4", "ViewerTheme__ol5"]);
  });

  it("renders checklists accessibly without role overrides", () => {
    const html = web(doc(checklist(li([t("done")], { checked: true }), li([t("todo")], { checked: false }))));
    expect(html).toContain('<ul class="ViewerTheme__ul ViewerTheme__checklist">');
    expect(html).toContain('class="ViewerTheme__listItem ViewerTheme__listItemChecked"');
    expect(html).toContain('class="ViewerTheme__listItem ViewerTheme__listItemUnchecked"');
    expect(html).toContain('<span class="bcf-sr-only">Completed: </span>done');
    expect(html).toContain('<span class="bcf-sr-only">Not completed: </span>todo');
    expect(html).not.toContain("role=");
  });

  it("renders nested bullet lists under bullet lists", () => {
    const html = web(doc(ul(li([t("a")]), li([ul(li([t("b")]))]))));
    expect(html).toBe(
      '<ul class="ViewerTheme__ul"><li class="ViewerTheme__listItem">a</li><li class="ViewerTheme__listItem ViewerTheme__nestedListItem"><ul class="ViewerTheme__ul"><li class="ViewerTheme__listItem">b</li></ul></li></ul>',
    );
  });
});

describe("web: code", () => {
  it("renders code blocks with theme classes, language and line-number gutter", () => {
    const html = web(doc(code("js", tok("const", "keyword"), tok(" x "), br(), tab(), tok("1", "number", "color: #905"))));
    expect(html).toBe(
      '<pre class="ViewerTheme__code" spellcheck="false" tabindex="0" data-language="js" data-gutter="1&#10;2">' +
        '<span class="ViewerTheme__tokenAttr">const</span> x <br>\t<span class="ViewerTheme__tokenProperty" style="color:#905">1</span></pre>',
    );
  });

  it("escapes code and rejects odd language names", () => {
    const html = web(doc(code("js\" onload=\"x", tok("<script>alert(1)</script> & \"q\""))));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("data-language");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;");
  });

  it("handles empty code blocks and unknown highlight types", () => {
    expect(web(doc(code(undefined)))).toContain('<pre class="ViewerTheme__code" spellcheck="false" tabindex="0" data-gutter="1"></pre>');
    expect(web(doc(code("x", tok("a", "made-up-token"))))).toContain("<pre");
    expect(web(doc(code("x", tok("a", "made-up-token"))))).not.toContain("class=\"undefined");
  });

  it("only allows color-ish style props on tokens", () => {
    const html = web(doc(code("x", tok("a", undefined, "color: #fff; position: fixed; font-style: italic; font-weight: 700"))));
    expect(html).toContain('<span style="color:#fff;font-style:italic;font-weight:700">a</span>');
    expect(html).not.toContain("position");
  });
});

describe("web: horizontal rule & page break", () => {
  it("renders hr with the theme class and page-break as a separate class", () => {
    expect(web(doc(hr()))).toBe('<hr class="ViewerTheme__hr">');
    expect(web(doc(pageBreak()))).toBe('<hr class="bcf-page-break" aria-hidden="true">');
  });
});

describe("web: tables", () => {
  const tbl = (extra = {}) =>
    table(
      [
        tr(cell([p(t("H1"))], { headerState: 3 }), cell([p(t("H2"))], { headerState: 1, colSpan: 2 })),
        tr(cell([p(t("r"))], { headerState: 2 }), cell([p(t("a"))], { backgroundColor: "#ffeeee", verticalAlign: "middle", width: 90 }), cell([p(t("b"))], { rowSpan: 2 })),
      ],
      extra,
    );

  it("renders a scrollable wrapper, header cells, spans, backgrounds and widths", () => {
    const html = web(doc(tbl({ colWidths: [100, 80, 60], rowStriping: true })));
    expect(checkWellFormed(html)).toEqual([]);
    expect(html.startsWith('<div class="ViewerTheme__tableScrollableWrapper" tabindex="0"><table class="ViewerTheme__table ViewerTheme__tableRowStriping">')).toBe(true);
    expect(html).toContain('<colgroup><col style="width:100px"><col style="width:80px"><col style="width:60px"></colgroup>');
    expect(html).toContain('<th class="ViewerTheme__tableCell ViewerTheme__tableCellHeader" scope="col">');
    expect(html).toContain('<th class="ViewerTheme__tableCell ViewerTheme__tableCellHeader" scope="col" colspan="2">');
    expect(html).toContain('<th class="ViewerTheme__tableCell ViewerTheme__tableCellHeader" scope="row">');
    expect(html).toContain('<td class="ViewerTheme__tableCell" style="width:90px;background-color:#ffeeee;vertical-align:middle">');
    expect(html).toContain('<td class="ViewerTheme__tableCell" rowspan="2">');
  });

  it("aligns tables and ignores invalid colWidths/backgrounds", () => {
    expect(web(doc(tbl({ format: "center" })))).toContain("ViewerTheme__table ViewerTheme__tableAlignmentCenter");
    expect(web(doc(tbl({ format: "right" })))).toContain("ViewerTheme__tableAlignmentRight");
    const bad = web(doc(table([tr(cell([p(t("x"))], { backgroundColor: "red; position:fixed" }))], { colWidths: [-5, 0, 40] })));
    expect(bad).not.toContain("position");
    expect(bad).not.toContain("<col");
  });

  it("renders empty cells with a <br> and skips tables without rows", () => {
    expect(web(doc(table([tr(cell([]))])))).toContain("<td class=\"ViewerTheme__tableCell\"><br></td>");
    expect(web(doc(table([])))).toBe("");
  });

  it("applies row heights", () => {
    expect(web(doc(table([{ ...tr(cell([p(t("x"))])), height: 48 }])))).toContain('<tr style="height:48px">');
  });
});

describe("web: images", () => {
  it("renders img with dimensions, lazy loading and responsive style", () => {
    expect(web(doc(p(image("https://img.example.com/a.png", "An image", { width: 640, height: 480 }))))).toBe(
      '<p class="ViewerTheme__paragraph"><img src="https://img.example.com/a.png" alt="An image" width="640" height="480" loading="lazy" decoding="async" style="max-width:100%;height:auto" class="bcf-image"></p>',
    );
  });

  it("omits width/height when they are 0 (inherit) and keeps empty alt", () => {
    const html = web(doc(p(image("/api/media/files/abc.webp", ""))));
    expect(html).toContain('src="/api/media/files/abc.webp" alt=""');
    expect(html).not.toContain("width=");
  });

  it("renders captions as figure/figcaption and swaps the <p> for a div to stay valid", () => {
    const html = web(doc(p(image("https://img.example.com/a.png", "Chart", { width: 400, height: 300 }, "Figure <1>"))));
    expect(checkWellFormed(html)).toEqual([]);
    expect(html.startsWith('<div role="paragraph" class="ViewerTheme__paragraph"><figure class="bcf-figure"><img ')).toBe(true);
    expect(html).toContain("<figcaption>Figure &lt;1&gt;</figcaption></figure></div>");
  });

  it("ignores empty captions and captions when showCaption is false", () => {
    expect(web(doc(p(image("https://a.example/x.png", "a", {}, ""))))).not.toContain("figure");
    expect(web(doc(p(image("https://a.example/x.png", "a", { showCaption: false }, "hidden"))))).not.toContain("figcaption");
  });

  it("allows inline raster data URIs on web only; drops SVG data URIs", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(web(doc(p(image(png, "px"))))).toContain(`src="${png}"`);
    const svg = web(doc(p(image("data:image/svg+xml;base64,PHN2Zz4=", "svg"))));
    expect(svg).not.toContain("<img");
    expect(svg).toContain("svg");
  });

  it("drops images with unsafe sources but keeps alt text", () => {
    const html = web(doc(p(image("javascript:alert(1)", "evil"))));
    expect(html).not.toContain("<img");
    expect(html).toContain("evil");
  });
});

describe("web: equations", () => {
  it("renders inline equations with KaTeX (MathML + HTML)", () => {
    const html = web(doc(p(equation("E=mc^2", true))));
    expect(html).toContain('<span class="bcf-equation"><span class="katex">');
    expect(html).toContain("katex-mathml");
    expect(html).toContain('<annotation encoding="application/x-tex">E=mc^2</annotation>');
    expect(checkWellFormed(html)).toEqual([]);
  });

  it("renders block equations in display mode", () => {
    const html = web(doc(equation("\\frac{a}{b}", false)));
    expect(html).toContain('<div class="bcf-equation bcf-equation--block"><span class="katex-display">');
  });

  it("does not throw on invalid LaTeX and never trusts \\href/\\url", () => {
    const bad = web(doc(equation("\\frac{", false)));
    expect(bad).toContain("katex");
    const trust = web(doc(equation("\\href{javascript:alert(1)}{click}", false)));
    expect(trust).not.toContain("javascript:alert(1)\"");
    expect(trust).not.toMatch(/<a\s/i);
    const html = web(doc(equation("\\includegraphics{http://evil.example/x.png}", true)));
    expect(html).not.toContain("<img");
  });
});

describe("web: embeds", () => {
  it("renders YouTube with a nocookie lazy iframe", () => {
    const html = web(doc(youtube("dQw4w9WgXcQ")));
    expect(html).toContain('<div class="bcf-embed bcf-embed--youtube">');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('title="YouTube video player"');
    expect(html).toContain("aspect-ratio:16/9");
    expect(html).toContain("sandbox=");
  });

  it("renders Figma and Tweet iframes on allowlisted hosts", () => {
    const f = web(doc(figma("AbCdEfGhIjKlMnOpQrStUv")));
    expect(f).toContain('src="https://www.figma.com/embed?embed_host=bcf&amp;url=https%3A%2F%2Fwww.figma.com%2Ffile%2FAbCdEfGhIjKlMnOpQrStUv"');
    expect(f).toContain('title="Figma embed"');
    const tw = web(doc(tweet("1234567890")));
    expect(tw).toContain('src="https://platform.twitter.com/embed/Tweet.html?dnt=true&amp;id=1234567890"');
    expect(tw).toContain('title="Embedded post on X"');
    expect(tw).toContain('loading="lazy"');
  });

  it("applies block alignment from `format`", () => {
    expect(web(doc(youtube("dQw4w9WgXcQ", "center")))).toContain('<div class="bcf-embed bcf-embed--youtube" style="text-align:center">');
  });

  it("uses plain links with embeds: 'link'", () => {
    const html = web(doc(youtube("dQw4w9WgXcQ"), tweet("123"), figma("AbCdEfGhIjKlMnOpQrStUv")), { embeds: "link" });
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('href="https://x.com/i/web/status/123"');
    expect(html).toContain('href="https://www.figma.com/file/AbCdEfGhIjKlMnOpQrStUv"');
  });

  it("skips embeds with invalid ids", () => {
    const r = renderContent(doc(youtube('x"><script>alert(1)</script>'), tweet("abc"), figma("a/b")));
    expect(r.html).toBe("");
    expect(r.warnings.filter((w) => w.code === "invalid-attribute")).toHaveLength(3);
  });
});

describe("web: layout & collapsible", () => {
  it("renders layout containers as CSS grid with theme classes", () => {
    const html = web(doc(layout("1fr 2fr", [p(t("L"))], [p(t("R"))])));
    expect(html).toBe(
      '<div class="ViewerTheme__layoutContainer" style="grid-template-columns:1fr 2fr" data-lexical-layout-container="true">' +
        '<div class="ViewerTheme__layoutItem" data-lexical-layout-item="true"><p class="ViewerTheme__paragraph">L</p></div>' +
        '<div class="ViewerTheme__layoutItem" data-lexical-layout-item="true"><p class="ViewerTheme__paragraph">R</p></div></div>',
    );
  });

  it("validates grid-template-columns and falls back to equal columns", () => {
    expect(web(doc(layout("1fr; background:url(x)", [p(t("a"))], [p(t("b"))])))).toContain("grid-template-columns:repeat(2, 1fr)");
    expect(web(doc(layout("", [p(t("a"))], [p(t("b"))], [p(t("c"))])))).toContain("grid-template-columns:repeat(3, 1fr)");
    expect(web(doc(layout("repeat(2, minmax(0, 1fr))", [p(t("a"))], [p(t("b"))])))).toContain("grid-template-columns:repeat(2, minmax(0, 1fr))");
  });

  it("renders collapsible as <details>/<summary> (open by default)", () => {
    const html = web(doc(collapsible("Title", [p(t("Body"))])));
    expect(html).toBe(
      '<details class="Collapsible__container" open><summary class="Collapsible__title">Title</summary>' +
        '<div class="Collapsible__content" data-lexical-collapsible-content="true"><p class="ViewerTheme__paragraph">Body</p></div></details>',
    );
    expect(web(doc(collapsible("T", [p(t("B"))], false)))).not.toContain(" open");
  });

  it("tolerates malformed collapsible structure", () => {
    const html = web(doc(el("collapsible-container", [el("collapsible-content", [p(t("only body"))])], { open: true })));
    expect(html).toContain("<summary");
    expect(html).toContain("only body");
  });
});

describe("web: unknown nodes", () => {
  it("skips unknown nodes entirely by default", () => {
    const html = web(doc(p(t("a")), { type: "callout", version: 1, children: [p(t("secret"))] }, p(t("b"))));
    expect(html).not.toContain("secret");
    expect(textOf(html)).toBe("ab");
  });

  it("can unwrap unknown nodes", () => {
    const html = web(doc({ type: "callout", version: 1, children: [p(t("shown"))] }), { unknown: "unwrap" });
    expect(html).toContain("shown");
  });

  it("skips unknown inline nodes", () => {
    expect(web(doc(p(t("a"), { type: "sparkle", version: 1 }, t("b"))))).toBe('<p class="ViewerTheme__paragraph">ab</p>');
  });
});
