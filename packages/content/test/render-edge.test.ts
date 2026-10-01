import { describe, expect, it } from "vitest";
import { parseContent, renderContent, renderHtml } from "../src/index";
import { cell, collapsible, datetime, doc, el, equation, image, li, p, t, tr } from "./helpers/build";
import { checkWellFormed } from "./helpers/html";

describe("renderer: misplaced structure is rendered, not dropped or crashed on", () => {
  it("renders stray structural nodes at the root as plain blocks", () => {
    const html = renderHtml(
      doc(
        li([t("loose item")]),
        tr(cell([p(t("loose cell"))])),
        el("layout-item", [p(t("loose layout item"))]),
        el("collapsible-title", [t("loose title")]),
        el("collapsible-content", [p(t("loose content"))]),
      ),
    );
    for (const text of ["loose item", "loose cell", "loose layout item", "loose title", "loose content"]) expect(html).toContain(text);
    expect(checkWellFormed(html)).toEqual([]);
  });

  it("wraps inline-level decorators found in block position", () => {
    const html = renderHtml(doc(image("https://a.example/x.png", "x"), datetime("2024-01-02T00:00:00.000Z"), equation("x", true)));
    expect(html).toContain("<img");
    expect(html).toContain("<time");
    expect(html).toContain("katex");
    expect(checkWellFormed(html)).toEqual([]);
  });

  it("renders block nodes found in inline context", () => {
    const html = renderHtml(doc(p(t("before"), collapsible("c", [p(t("inside"))]), t("after"))));
    expect(html).toContain("before");
    expect(html).toContain("inside");
    expect(html).toContain("after");
  });

  it("renders list items with a non-listitem child", () => {
    const html = renderHtml(doc(el("list", [t("bare text") as never], { listType: "bullet", start: 1, tag: "ul" })));
    expect(html).toContain("bare text");
  });

  it("skips invalid dates and nested root nodes gracefully", () => {
    const r = renderContent(doc(p(datetime("garbage"))));
    expect(r.html).toBe('<p class="ViewerTheme__paragraph"><br></p>');
    expect(renderHtml(doc(el("root", [p(t("nested root"))])))).toContain("nested root");
  });

  it("collapses unknown nodes inside tables, lists and layouts without breaking structure", () => {
    const html = renderHtml(
      doc({
        type: "table",
        version: 1,
        children: [{ type: "tablerow", version: 1, children: [{ type: "mystery", version: 1 }, { type: "tablecell", version: 1, headerState: 0, colSpan: 1, rowSpan: 1, children: [p(t("ok"))] }] }],
      }),
    );
    expect(html).toContain("ok");
    expect(checkWellFormed(html)).toEqual([]);
  });

  it("is a pure function of its input (no mutation of the given document)", () => {
    const d = doc(p(t("x", 1, "color:red")), { type: "mystery", version: 1, children: [] });
    const before = JSON.stringify(d);
    renderHtml(d);
    renderHtml(d, { target: "email" });
    renderHtml(d, { target: "rss" });
    expect(JSON.stringify(d)).toBe(before);
  });

  it("isolates a failure inside one block (render-error warning) and keeps rendering the rest", () => {
    const parsed = parseContent(doc(p(t("before")), p(t("boom")), p(t("after")))).content;
    Object.defineProperty(parsed.root.children[1], "children", {
      get() {
        throw new Error("kaboom");
      },
    });
    const r = renderContent(parsed);
    expect(r.html).toContain("before");
    expect(r.html).toContain("after");
    expect(r.html).not.toContain("boom");
    expect(r.warnings.map((w) => w.code)).toContain("render-error");
  });

  it("unwraps unknown nodes that carry text", () => {
    expect(renderHtml(doc({ type: "sparkle", version: 1, text: "shiny <b>" }), { unknown: "unwrap" })).toBe('<p class="ViewerTheme__paragraph">shiny &lt;b&gt;</p>');
  });

  it("treats an invalid target as web", () => {
    expect(renderHtml(doc(p(t("x"))), { target: "pdf" as never })).toBe('<p class="ViewerTheme__paragraph">x</p>');
  });
});
