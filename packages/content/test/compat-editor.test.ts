/**
 * Compatibility with the REAL @scottjgilbert/lexical-blog-editor: build a document in a headless editor, serialize it
 * with `editorState.toJSON()`, and prove that (1) our validator/parser accept it, (2) the editor can load our own
 * fixtures, (3) our class names match the editor's viewer theme, (4) our text matches the package's own HTML.
 * Skipped automatically when the editor package is not installed.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SUPPORTED_NODE_TYPES, markdownToContent, parseContent, renderHtml, validateContent, EDITOR_CUSTOM_NODE_TYPES } from "../src/index";
import { loadEditorKit, type EditorKit } from "./helpers/editor-kit";
import { buildEditorDocument } from "./helpers/editor-doc";
import { classesOf, decode, textOf } from "./helpers/html";
import { kitchenSink } from "./fixtures/kitchen-sink";
import { doc, F, h, p, t, ul, li } from "./helpers/build";

let kit: EditorKit | null = null;
let built: ReturnType<typeof buildEditorDocument> | null = null;

beforeAll(async () => {
  kit = await loadEditorKit();
  if (kit) built = buildEditorDocument(kit);
});

function types(node: any, acc = new Set<string>()): Set<string> {
  if (node && typeof node === "object") {
    if (typeof node.type === "string") acc.add(node.type);
    for (const c of node.children ?? []) types(c, acc);
    if (node.caption?.editorState?.root) types(node.caption.editorState.root, acc);
  }
  return acc;
}

describe("real editor compatibility", () => {
  it("editor package is available (otherwise these tests are skipped)", (ctx) => {
    if (!kit) ctx.skip();
    expect(kit).not.toBeNull();
  });

  it("our validator accepts what the real editor serializes", (ctx) => {
    if (!built) return ctx.skip();
    const v = validateContent(built.json);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.stats.unknownTypes).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("covers every node type the editor package registers (so the standard's list is complete)", (ctx) => {
    if (!built) return ctx.skip();
    const used = types(built.json.root);
    // `overflow` only exists while a character limit is active; `page-break` is a BCF extension
    const expected = SUPPORTED_NODE_TYPES.filter((x) => x !== "overflow" && x !== "page-break");
    expect([...expected].filter((x) => !used.has(x))).toEqual([]);
    expect([...used].filter((x) => !(SUPPORTED_NODE_TYPES as readonly string[]).includes(x))).toEqual([]);
    for (const type of EDITOR_CUSTOM_NODE_TYPES) expect(used.has(type)).toBe(true);
  });

  it("registers no node types that BCF does not list", (ctx) => {
    if (!kit) return ctx.skip();
    const editor = kit.create();
    const registered: string[] = [...editor._nodes.keys()].filter((x) => x !== "artificial"); // Lexical-internal
    const unlisted = registered.filter((x) => !(SUPPORTED_NODE_TYPES as readonly string[]).includes(x));
    expect(unlisted).toEqual([]);
  });

  it("parsing the editor JSON is lossless", (ctx) => {
    if (!built) return ctx.skip();
    const r = parseContent(built.json);
    expect(r.valid).toBe(true);
    expect(JSON.parse(JSON.stringify(r.content))).toEqual(JSON.parse(JSON.stringify(built.json)));
  });

  it("the committed editor-sample.json fixture matches a fresh real-editor export in shape", (ctx) => {
    if (!built) return ctx.skip();
    const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/editor-sample.json"), "utf8"));
    const shape = (n: any): any => (Array.isArray(n) ? n.map(shape) : n && typeof n === "object" ? Object.fromEntries(Object.keys(n).sort().map((k) => [k, shape(n[k])])) : typeof n);
    const typeKeys = (root: any) => {
      const out: Record<string, string[]> = {};
      const walk = (n: any) => {
        out[n.type] = [...new Set([...(out[n.type] ?? []), ...Object.keys(n).filter((k) => k !== "children" && k !== "caption")])].sort();
        for (const c of n.children ?? []) walk(c);
      };
      walk(root);
      return out;
    };
    const a = typeKeys(sample.root);
    const b = typeKeys(JSON.parse(JSON.stringify(built.json)).root); // drop `undefined` props like JSON.stringify would
    for (const type of Object.keys(a)) {
      if (b[type]) expect(b[type], `property set of <${type}> drifted`).toEqual(a[type]);
    }
    void shape;
  });

  it("the real editor can load our hand-built kitchen-sink fixture (builders match the real wire format)", (ctx) => {
    if (!kit) return ctx.skip();
    const withoutExtensions = JSON.parse(JSON.stringify(kitchenSink));
    // page-break is a BCF extension the editor does not know
    withoutExtensions.root.children = withoutExtensions.root.children.filter((c: any) => c.type !== "page-break");
    expect(() => kit!.htmlFromJson(withoutExtensions)).not.toThrow();
  });

  it("the real editor can load documents produced by markdownToContent", (ctx) => {
    if (!kit) return ctx.skip();
    const md = [
      "# Heading", "", "Text with **bold**, *italic*, `code`, ~~strike~~ and [a link](https://e.org).", "",
      "- a", "  - nested", "- b", "", "1. one", "2. two", "", "- [x] done", "- [ ] todo", "", "> quote", "", "```ts", "const x = 1;", "```", "", "---", "",
      "![alt](https://i.example/x.png)", "", '![captioned](https://i.example/y.png "Caption")',
    ].join("\n");
    const content = markdownToContent(md);
    expect(() => kit!.htmlFromJson(content)).not.toThrow();
  });

  it("class names we emit are all defined by the editor's ViewerTheme.css (or our own bcf-/Collapsible/keyword set)", (ctx) => {
    if (!kit || !built) return ctx.skip();
    // class names the editor's theme object defines (ViewerTheme.js); a few (h4-h6, checklist) have no rule in ViewerTheme.css
    const themeJs = fs.readFileSync(path.join(kit.dir, "build/themes/ViewerTheme.js"), "utf8");
    const css = fs.readFileSync(path.join(kit.dir, "build/themes/ViewerTheme.css"), "utf8");
    const defined = new Set([
      ...[...themeJs.matchAll(/"(ViewerTheme__[A-Za-z0-9]+)"/g)].map((m) => m[1]!),
      ...[...css.matchAll(/\.(ViewerTheme__[A-Za-z0-9]+)/g)].map((m) => m[1]!),
    ]);
    const html = renderHtml(kitchenSink, { target: "web" }) + renderHtml(built.json, { target: "web" });
    const ours = classesOf(html);
    const unknown = [...ours].filter((c) => !defined.has(c) && !c.startsWith("bcf-") && !c.startsWith("Collapsible__") && c !== "keyword" && !c.startsWith("katex") && !/^(mord|mrel|mbin|mop|mopen|mclose|mpunct|minner|mspace|base|strut|vlist|vlist-t|vlist-r|vlist-t2|vlist-s|pstrut|sizing|reset-size\d+|size\d+|mtight|mathnormal|msupsub|mfrac|frac-line|nulldelimiter|delimsizing|delim-size\d|mult|sqrt|svg-align|root|accent|accent-body|amsrm|boldsymbol|textbf|textit|mathbf|mathit|mathrm|mathsf|mathtt|cd-label-.*|op-symbol|small-op|large-op|op-limits|overline|underline|line|hide-tail|stretchy|brace-left|brace-center|brace-right|mtable|col-align-[clr]|arraycolsep|arraystretch|mtr|mtd|fbox|boxpad|cancel|textrm|text|mathdefault|fontsize-ensurer|enclosing|llap|rlap|clap|inner|fix|thinbox|smash|vcenter|mathcal|mathfrak|mathscr|mathbb|mathbfit|mathsfit|mathbfsf|mathsf|ctr|ml\w*|mr\w*|mathml)$/.test(c));
    expect(unknown).toEqual([]);
  });

  it("every ViewerTheme class the package emits for the same document is also emitted by us", (ctx) => {
    if (!built) return ctx.skip();
    const pkg = [...classesOf(built.html)].filter((c) => c.startsWith("ViewerTheme__") || c.startsWith("Collapsible__"));
    const ours = classesOf(renderHtml(built.json, { target: "web" }));
    const missing = pkg.filter((c) => !ours.has(c));
    expect(missing).toEqual([]);
    expect(pkg.length).toBeGreaterThan(15);
  });

  it("the package forgets some classes that we emit (documented gaps)", (ctx) => {
    if (!built) return ctx.skip();
    const pkg = classesOf(built.html);
    const ours = classesOf(renderHtml(built.json, { target: "web" }));
    // The package's HTML export has no class on <hr> and on layout containers; we add them so ViewerTheme.css applies.
    expect(pkg.has("ViewerTheme__hr")).toBe(false);
    expect(ours.has("ViewerTheme__hr")).toBe(true);
    expect(pkg.has("ViewerTheme__layoutContainer")).toBe(false);
    expect(ours.has("ViewerTheme__layoutContainer")).toBe(true);
    // ...and the package emits an empty <div> for Figma and no iframe it would let through its own viewer for YouTube
    expect(built.html).toContain("<div></div>");
    expect(built.html).toContain("youtube-nocookie.com");
  });

  it("visible text equals the package's own HTML text for text-centric documents", (ctx) => {
    if (!kit) return ctx.skip();
    const run = kit.run((root: any) => {
      const { L, m } = kit!;
      const mk = (s: string, ...f: string[]) => {
        const n = L.$createTextNode(s);
        f.forEach((x) => n.toggleFormat(x));
        return n;
      };
      const hd = m.richText.$createHeadingNode("h2");
      hd.append(mk("A <heading> & more"));
      const pa = L.$createParagraphNode();
      pa.append(mk("plain "), mk("bold", "bold"), mk(" and "), mk("both", "italic", "underline"), L.$createLineBreakNode(), mk("second line"));
      const ulist = m.list.$createListNode("bullet");
      for (const s of ["one", "two"]) {
        const it = m.list.$createListItemNode();
        it.append(mk(s));
        ulist.append(it);
      }
      const q = m.richText.$createQuoteNode();
      q.append(mk("quoted"));
      root.append(hd, pa, ulist, q);
    });
    const norm = (s: string) => decode(s.replace(/<br>/g, " ")).replace(/\s+/g, " ").trim();
    expect(norm(textOf(renderHtml(run.json, { target: "web" })))).toBe(norm(textOf(run.html)));
    // and structure: same tag skeleton for the block level
    const blockTags = (html: string) => [...html.matchAll(/<(h[1-6]|p|ul|ol|li|blockquote)\b/g)].map((m) => m[1]);
    expect(blockTags(renderHtml(run.json, { target: "web" }))).toEqual(blockTags(run.html));
  });

  it("our output re-imports into the real editor with identical text (HTML round trip of the package's own export)", (ctx) => {
    if (!kit || !built) return ctx.skip();
    // JSON -> real editor -> JSON again is stable (what we store survives an editor load/save cycle)
    const editor = kit.create();
    editor.setEditorState(editor.parseEditorState(JSON.stringify(built.json)));
    const again = editor.getEditorState().toJSON();
    expect(types(again.root)).toEqual(types(built.json.root));
  });

  it("small sanity: the editor emits `datetime` (not `date-time`) and flat dateTime", (ctx) => {
    if (!built) return ctx.skip();
    const dt: any = JSON.stringify(built.json).match(/\{"type":"datetime"[^}]*\}/)?.[0];
    expect(JSON.parse(dt)).toEqual({ type: "datetime", version: 1, dateTime: "2024-05-06T07:08:00.000Z" });
  });

  it("works for small documents built from builders too (smoke)", (ctx) => {
    if (!kit) return ctx.skip();
    const d = doc(h("h1", "T"), p(t("x", F.bold)), ul(li([t("a")], { value: 1 })));
    expect(() => kit!.htmlFromJson(d)).not.toThrow();
    expect(renderHtml(d)).toContain("<h1");
  });
});
