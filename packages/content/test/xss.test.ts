import { describe, expect, it } from "vitest";
import { EMBED_HOSTS, isAllowedEmbedUrl, parseContent, renderContent, renderHtml, sanitizeStyle, sanitizeUrl, toPlainText } from "../src/index";
import {
  F, a, auto, cell, code, collapsible, datetime, doc, el, emoji, equation, figma, h, image, layout, li, mention, p, t, table, tok, tr, tweet, ul, youtube,
} from "./helpers/build";
import { allAttributes, checkWellFormed, tagsOf, textOf } from "./helpers/html";
import { kitchenSink } from "./fixtures";

const PAYLOADS = [
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "' onmouseover='alert(1)",
  '" onfocus="alert(1)" autofocus="',
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "java\tscript:alert(1)",
  " \n javascript:alert(1)",
  "&#106;avascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "</style><script>alert(1)</script>",
  "<svg/onload=alert(1)>",
  "<iframe src=javascript:alert(1)></iframe>",
  "<iframe src=\"https://evil.example/\"></iframe>",
  "color:red;background:url(javascript:alert(1))",
  "expression(alert(1))",
  "\\0061lert(1)",
  "\u0000<b>",
  "`onerror=alert(1)`",
];

const ALLOWED_TAGS = new Set([
  "p", "div", "span", "a", "strong", "em", "u", "s", "code", "sub", "sup", "mark", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "ul", "ol", "li", "pre", "table", "tbody", "tr", "th", "td", "colgroup", "col", "img", "figure", "figcaption",
  "details", "summary", "time", "iframe",
]);

/** Deep clone replacing every string leaf (except structural `type`) with `payload`. */
function poison(node: unknown, payload: string): unknown {
  if (Array.isArray(node)) return node.map((n) => poison(n, payload));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = k === "type" || k === "version" ? v : typeof v === "string" ? payload : poison(v, payload);
    }
    return out;
  }
  return node;
}

function assertSafe(html: string, target: string, ctx: string) {
  const where = `${ctx} [${target}]`;
  // 1. only allowlisted tags
  const tags = [...tagsOf(html)].filter((x) => !ALLOWED_TAGS.has(x));
  // KaTeX markup is allowed when it came from an equation render
  expect(tags.filter((x) => !html.includes('class="katex'))).toEqual([]);
  // 2. attributes
  for (const attr of allAttributes(html)) {
    expect(attr.name.startsWith("on"), `${where}: event handler ${attr.name}`).toBe(false);
    if (attr.name === "href" || attr.name === "src") {
      const v = attr.value.replace(/[\u0000- ]/g, "").toLowerCase();
      expect(v.startsWith("javascript:"), `${where}: ${attr.name}=${attr.value}`).toBe(false);
      expect(v.startsWith("vbscript:"), where).toBe(false);
      expect(/^data:(?!image\/(png|jpe?g|gif|webp|avif);base64,)/.test(v), `${where}: ${attr.name}=${attr.value}`).toBe(false);
    }
    if (attr.name === "style") {
      for (const decl of attr.value.split(";")) {
        const prop = decl.split(":")[0]!.trim().toLowerCase();
        if (!prop) continue;
        expect(
          [
            "color", "background-color", "font-size", "font-family", "text-align", "font-style", "font-weight", "text-decoration",
            // properties the renderer itself emits (never from content strings)
            "padding-inline-start", "margin-left", "margin", "line-height", "width", "height", "max-width", "vertical-align", "aspect-ratio",
            "border", "grid-template-columns", "white-space", "border-collapse", "padding", "background", "border-left", "border-radius", "font-weight",
            "font-family", "font-size", "text-transform", "border-top", "color", "display", "outline", "text-decoration", "list-style-type",
            "word-break", "overflow", "text-align", "mso-hide", "opacity", "max-height", "-webkit-text-size-adjust", "text-decoration",
            "background-color", "margin-bottom", "margin-top",
          ].includes(prop),
          `${where}: style property ${prop} in "${attr.value}"`,
        ).toBe(true);
        expect(/url\s*\(|expression|javascript|@import|<|>/i.test(decl), `${where}: style "${decl}"`).toBe(false);
      }
    }
  }
  // 3. iframes only to allowlisted hosts
  for (const m of html.matchAll(/<iframe\b[^>]*\bsrc="([^"]*)"/g)) {
    const src = m[1]!.replace(/&amp;/g, "&");
    expect(isAllowedEmbedUrl(src), `${where}: iframe src ${src}`).toBe(true);
  }
  // 4. text never contains a raw '<' that is not the start of a tag we emitted
  expect(checkWellFormed(html), where).toEqual([]);
}

/** KaTeX emits its own (trusted) inline styles; equations are fuzzed separately below. */
function withoutEquations(node: any): any {
  if (Array.isArray(node)) return node.filter((n) => n?.type !== "equation").map(withoutEquations);
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, withoutEquations(v)]));
  return node;
}

describe("XSS: payloads injected into every string of every node", () => {
  const base = withoutEquations(kitchenSink);
  for (const payload of PAYLOADS) {
    it(`survives ${JSON.stringify(payload).slice(0, 48)}`, () => {
      const poisoned = poison(base, payload);
      for (const target of ["web", "email", "rss"] as const) {
        const html = renderHtml(poisoned, { target, baseUrl: "https://blog.example.com" });
        assertSafe(html, target, payload);
        // plain text derivations must not throw either
        expect(() => toPlainText(poisoned)).not.toThrow();
      }
    });
  }

  it("also holds for payloads in individual fields of a hand-built document", () => {
    for (const payload of PAYLOADS) {
      const d = doc(
        h("h2", payload),
        p(t(payload, F.bold, `color:${payload}`), a(payload, t(payload)), auto(payload), emoji(payload), mention(payload)),
        p(image(payload, payload, {}, payload)),
        code(payload, tok(payload, payload, payload)),
        table([tr(cell([p(t(payload))], { backgroundColor: payload }))], { colWidths: [payload] }),
        layout(payload, [p(t(payload))]),
        { ...collapsible(payload, [p(t(payload))]) },
        ul(li([a(payload, t(payload))])),
        el("paragraph", [t("x")], { format: payload, indent: payload }),
      );
      for (const target of ["web", "email", "rss"] as const) assertSafe(renderHtml(d, { target }), target, payload);
    }
  });
});

describe("XSS: targeted cases", () => {
  it("escapes text, attribute values and ids", () => {
    const html = renderHtml(doc(h("h2", '"><script>alert(1)</script>'), p(t("<img src=x onerror=alert(1)>"))));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toMatch(/id="[a-z0-9-]+"/);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "  javascript:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:alert(1)",
    "file:///etc/passwd",
    "blob:https://x/uuid",
    "ftp://example.com/x",
    "about:blank",
    "\\\\evil.example\\share",
    "/\\evil.example",
    "https://evil.example\\@good.example",
    "custom-scheme://x",
    "1http://x",
    "http:",
    "https://",
    "mailto:",
  ])("rejects link URL %j", (url) => {
    const html = renderHtml(doc(p(a(url, t("x")))));
    expect(html).not.toContain("<a ");
    expect(sanitizeUrl(url)).toBeNull();
  });

  it.each([
    ["https://example.com/a?b=c#d", "https://example.com/a?b=c#d"],
    ["http://example.com", "http://example.com"],
    ["mailto:me@example.com?subject=hi", "mailto:me@example.com?subject=hi"],
    ["tel:+1 (555) 123-4567", "tel:+1 (555) 123-4567"],
    ["/relative/path", "/relative/path"],
    ["relative/path", "relative/path"],
    ["#frag", "#frag"],
    ["?q=1", "?q=1"],
    ["./a", "./a"],
  ])("accepts %j", (url, href) => {
    expect(sanitizeUrl(url)?.href).toBe(href);
  });

  it("never lets a style string break out of the attribute", () => {
    const html = renderHtml(doc(p(t("x", 0, 'color: red" onmouseover="alert(1)'))));
    expect(html).not.toContain("onmouseover");
    const html2 = renderHtml(doc(p(t("x", 0, "font-family: Arial;\"><script>alert(1)</script>"))));
    expect(html2).not.toContain("<script");
  });

  it("rejects dangerous CSS values", () => {
    for (const style of [
      "color: url(javascript:alert(1))",
      "color: expression(alert(1))",
      "background-color: var(--x)",
      "font-size: calc(100% + 1px)",
      "font-family: Arial, \"; } body { display:none",
      "color: red !important",
      "color: \\72 ed",
      "color: red/*",
      "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh",
      "behavior: url(x.htc)",
      "-moz-binding: url(x)",
    ]) {
      const { declarations } = sanitizeStyle(style);
      expect(declarations.filter(([p]) => p !== "color" || /url|expression|\\/.test(style))).toEqual([]);
    }
    expect(sanitizeStyle("color: rgb(0, 0, 0); font-size: 12px").declarations).toEqual([["color", "rgb(0, 0, 0)"], ["font-size", "12px"]]);
    expect(sanitizeStyle("color: #FFF; color: blue").declarations).toEqual([["color", "blue"]]); // last wins
  });

  it("blocks iframe hosts that are not allowlisted", () => {
    expect(isAllowedEmbedUrl("https://www.youtube-nocookie.com/embed/x")).toBe(true);
    for (const bad of [
      "https://evil.example/embed",
      "http://www.youtube.com/embed/x",
      "https://www.youtube.com.evil.example/embed/x",
      "https://evil.example/?https://www.youtube.com/embed/",
      "https://user:pw@www.youtube.com/embed/x",
      "javascript:alert(1)",
      "//www.youtube.com/embed/x",
      "https://youtube.com.evil.example/",
    ]) {
      expect(isAllowedEmbedUrl(bad), bad).toBe(false);
    }
    expect([...EMBED_HOSTS.youtube, ...EMBED_HOSTS.figma, ...EMBED_HOSTS.twitter].sort()).toEqual([
      "platform.twitter.com", "www.figma.com", "www.youtube-nocookie.com", "www.youtube.com",
    ]);
  });

  it("builds iframe sources only from validated ids (id cannot inject host or attributes)", () => {
    for (const id of ["../../evil", 'abc" onload="alert(1)', "a b c d e f", "x".repeat(200), "", "javascript:1"]) {
      const html = renderHtml(doc(youtube(id), figma(id), tweet(id)));
      expect(html).toBe("");
    }
    const ok = renderHtml(doc(youtube("dQw4w9WgXcQ"), figma("AbCdEfGhIjKlMnOpQrStUv"), tweet("1234567890")));
    for (const m of ok.matchAll(/<iframe\b[^>]*\bsrc="([^"]*)"/g)) expect(isAllowedEmbedUrl(m[1]!.replace(/&amp;/g, "&"))).toBe(true);
    expect(ok.match(/<iframe/g)).toHaveLength(3);
  });

  it("does not render SVG or other active image data URIs", () => {
    for (const src of [
      "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/png;base64,AAAA\"onerror=\"alert(1)",
    ]) {
      expect(renderHtml(doc(p(image(src, "x"))))).not.toContain("<img");
    }
  });

  it("rejects non-http(s) dates, equation shenanigans and class injection", () => {
    expect(renderHtml(doc(p(datetime('"><script>alert(1)</script>'))))).not.toContain("script");
    const eq = renderHtml(doc(equation("\\htmlClass{x}{y}\\htmlId{z}{w}\\htmlStyle{color:red}{q}\\htmlData{a=b}{c}", false)));
    expect(eq).not.toMatch(/\sid="z"/);
    expect(eq).not.toContain("onerror");
    const emojiHtml = renderHtml(doc(p(emoji("x", 'a" onclick="alert(1)'))));
    expect(emojiHtml).not.toContain("onclick");
  });

  it("copes with absurdly deep nesting without a stack overflow", () => {
    let node: any = p(t("core"));
    for (let i = 0; i < 100_000; i++) node = { type: "quote", version: 1, children: [node] };
    for (const target of ["web", "email", "rss"] as const) {
      expect(() => renderHtml(doc(node), { target })).not.toThrow();
    }
    const r = renderContent(doc(node));
    expect(r.html).toBe("");
    // a legal-but-deep tree (within the limit) renders
    let ok: any = p(t("legal"));
    for (let i = 0; i < 40; i++) ok = { type: "layout-item", version: 1, children: [ok] };
    expect(renderHtml(doc(ok))).toContain("legal");
  });

  it("copes with huge widths (many nodes) in bounded time", () => {
    const many = Array.from({ length: 60_000 }, () => p(t("x")));
    const start = Date.now();
    const r = renderContent(doc(...many));
    expect(r.warnings.some((w) => w.code === "max-nodes")).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("bounds KaTeX work", () => {
    const start = Date.now();
    const html = renderHtml(doc(equation("\\def\\a{\\a\\a}\\a", false), equation("x".repeat(20_000), false), equation("\\rule{9999em}{9999em}", false)));
    expect(Date.now() - start).toBeLessThan(5000);
    expect(typeof html).toBe("string");
    expect(textOf(html)).not.toContain("undefined");
  });

  it("treats percent/entity-looking text in URLs as data, never as a scheme", () => {
    const html = renderHtml(doc(p(a("javascript&colon;alert(1)", t("x")), a("jav&#x61;script:alert(1)", t("y")))));
    // either dropped or escaped; in no case does an attribute contain a live `javascript:`
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('href="jav&#x61;');
  });

  it("fuzzes equations: KaTeX output never carries scripts, handlers or links", () => {
    for (const payload of [...PAYLOADS, "\\href{javascript:alert(1)}{x}", "\\url{javascript:alert(1)}", "\\includegraphics{x}", "\\htmlClass{a}{b}", "\\text{<script>}"]) {
      for (const inline of [true, false]) {
        const html = renderHtml(doc(inline ? p(equation(payload, true)) : equation(payload, false)));
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/<img/i);
        expect(html).not.toMatch(/<iframe/i);
        expect(html).not.toMatch(/<a\s/i);
        expect(allAttributes(html).filter((x) => x.name.startsWith("on") || x.name === "href" || x.name === "src")).toEqual([]);
        expect(checkWellFormed(html.replace(/<(\/?)(math|semantics|mrow|mi|mo|mn|msup|msub|mfrac|mtext|mspace|mstyle|annotation|mpadded|mover|munder|msqrt|mtable|mtr|mtd|menclose|merror|mphantom)\b[^>]*>/g, ""))).toEqual([]);
      }
    }
  });

  it("does not leak prototype-polluting keys", () => {
    const evil = JSON.parse('{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"__proto__":{"isAdmin":true},"children":[{"type":"text","version":1,"text":"x","format":0,"style":"","constructor":{"prototype":{"polluted":1}}}]}]}}');
    const html = renderHtml(evil);
    expect(html).toBe('<p class="ViewerTheme__paragraph">x</p>');
    expect(({} as any).isAdmin).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    const parsed: any = parseContent(evil);
    expect(parsed.warnings.some((w: any) => w.code === "forbidden-key")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed.content.root.children[0], "__proto__")).toBe(false);
  });
});
