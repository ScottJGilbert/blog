import { describe, expect, it } from "vitest";
import {
  CONTENT_LIMITS,
  SUPPORTED_NODE_TYPES,
  emptyContent,
  parseContent,
  validateContent,
} from "../src/index";
import { doc, el, h, p, t, quote } from "./helpers/build";
import { editorSample, kitchenSink } from "./fixtures";

function collectTypes(node: any, acc = new Set<string>()): Set<string> {
  if (node && typeof node === "object") {
    if (typeof node.type === "string") acc.add(node.type);
    for (const c of node.children ?? []) collectTypes(c, acc);
    if (node.caption?.editorState?.root) collectTypes(node.caption.editorState.root, acc);
  }
  return acc;
}

describe("SUPPORTED_NODE_TYPES", () => {
  it("lists every node type exactly once", () => {
    expect(new Set(SUPPORTED_NODE_TYPES).size).toBe(SUPPORTED_NODE_TYPES.length);
  });
  it("contains the core, @lexical and editor-package node types", () => {
    for (const type of [
      "root", "paragraph", "text", "linebreak", "tab", "heading", "quote", "list", "listitem", "link", "autolink", "code",
      "code-highlight", "horizontalrule", "table", "tablerow", "tablecell", "hashtag", "mark", "overflow", "image", "equation",
      "emoji", "mention", "keyword", "specialText", "youtube", "tweet", "figma", "layout-container", "layout-item",
      "collapsible-container", "collapsible-title", "collapsible-content", "datetime", "page-break",
    ]) {
      expect(SUPPORTED_NODE_TYPES).toContain(type);
    }
  });
  it("the kitchen-sink fixture exercises every supported type", () => {
    const used = collectTypes(kitchenSink.root);
    const missing = SUPPORTED_NODE_TYPES.filter((x) => !used.has(x));
    expect(missing).toEqual([]);
  });
  it("the real editor sample only uses supported types", () => {
    const used = [...collectTypes(editorSample.root)];
    expect(used.filter((x) => !(SUPPORTED_NODE_TYPES as readonly string[]).includes(x))).toEqual([]);
  });
});

describe("emptyContent", () => {
  it("is a valid document with one empty paragraph (like a fresh editor)", () => {
    const c = emptyContent();
    expect(validateContent(c).ok).toBe(true);
    expect(c.root.children).toHaveLength(1);
    expect(c.root.children[0]!.type).toBe("paragraph");
  });
  it("returns a fresh object each call", () => {
    expect(emptyContent()).not.toBe(emptyContent());
  });
});

describe("validateContent (strict)", () => {
  it("accepts the kitchen sink and the real editor sample", () => {
    const k = validateContent(kitchenSink);
    expect(k.errors).toEqual([]);
    expect(k.ok).toBe(true);
    expect(k.stats.unknownTypes).toEqual([]);
    const e = validateContent(editorSample);
    expect(e.errors).toEqual([]);
    expect(e.ok).toBe(true);
  });

  it.each([
    ["null", null],
    ["number", 5],
    ["array", []],
    ["no root", {}],
    ["root not object", { root: "x" }],
  ])("rejects %s", (_n, input) => {
    const r = validateContent(input);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.code).toBe("invalid-root");
  });

  it("rejects wrong root.type and missing children", () => {
    expect(validateContent({ root: { type: "paragraph", version: 1, children: [] } }).ok).toBe(false);
    expect(validateContent({ root: { type: "root", version: 1 } }).ok).toBe(false);
  });

  it("accepts a JSON string and reports bad JSON", () => {
    expect(validateContent(JSON.stringify(kitchenSink)).ok).toBe(true);
    const bad = validateContent("{nope");
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]!.code).toBe("invalid-json");
  });

  it("flags unknown node types as warnings (not errors) and reports them in stats", () => {
    const d = doc(p(t("hi")), { type: "callout", version: 1, children: [p(t("inside"))], tone: "info" });
    const r = validateContent(d);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("unknown-node-type");
    expect(r.stats.unknownTypes).toEqual(["callout"]);
  });

  it("errors on nodes without a string type or that are not objects", () => {
    expect(validateContent(doc({ version: 1 } as any)).ok).toBe(false);
    expect(validateContent(doc("text" as any)).ok).toBe(false);
    expect(validateContent(doc(null as any)).ok).toBe(false);
  });

  it("errors on invalid required attributes", () => {
    expect(validateContent(doc({ ...h("h1", "x"), tag: "h9" })).ok).toBe(false);
    expect(validateContent(doc(p({ type: "text", version: 1, text: 42 } as any))).ok).toBe(false);
    expect(validateContent(doc({ type: "youtube", version: 1, videoID: "<script>" })).ok).toBe(false);
    expect(validateContent(doc({ type: "datetime", version: 1, dateTime: "not a date" })).ok).toBe(false);
    expect(validateContent(doc({ type: "equation", version: 1, equation: "x".repeat(CONTENT_LIMITS.maxEquationLength + 1), inline: false })).ok).toBe(false);
  });

  it("errors on dangerous link schemes but only warns for merely non-allowlisted ones", () => {
    const bad = validateContent(doc(p({ type: "link", version: 1, url: "javascript:alert(1)", children: [t("x")] })));
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.code === "unsafe-url")).toBe(true);
    const sms = validateContent(doc(p({ type: "link", version: 1, url: "sms:+123", children: [t("x")] })));
    expect(sms.ok).toBe(true);
    expect(sms.warnings.some((e) => e.code === "unsafe-url")).toBe(true);
  });

  it("enforces max depth", () => {
    let node: any = p(t("deep"));
    for (let i = 0; i < CONTENT_LIMITS.maxDepth + 10; i++) node = quote(node);
    const r = validateContent(doc(node));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "max-depth")).toBe(true);
  });

  it("accepts nesting exactly at the limit", () => {
    let node: any = el("paragraph", [t("x")]);
    // depth: root(0) > layout-item... use quote chain of unknown elements to avoid placement noise
    for (let i = 0; i < CONTENT_LIMITS.maxDepth - 2; i++) node = { type: "wrapper", version: 1, children: [node] };
    expect(validateContent(doc(node)).ok).toBe(true);
  });

  it("enforces max nodes", () => {
    const many = Array.from({ length: 120 }, () => p(t("x")));
    const r = validateContent(doc(...many), { maxNodes: 100 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "max-nodes")).toBe(true);
  });

  it("enforces max serialized size", () => {
    const r = validateContent(doc(p(t("x".repeat(2000)))), { maxBytes: 1000 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "max-bytes")).toBe(true);
  });

  it("rejects non-finite numbers", () => {
    const d: any = doc(p(t("x")));
    d.root.children[0].indent = Infinity;
    const r = validateContent(d);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "non-finite-number")).toBe(true);
    const d2: any = doc({ type: "image", version: 1, src: "https://a/b.png", altText: "", width: NaN, height: 0, maxWidth: 500, showCaption: false });
    expect(validateContent(d2).ok).toBe(false);
  });

  it("rejects non-JSON values, class instances and __proto__ keys", () => {
    const d: any = doc(p(t("x")));
    d.root.children[0].fn = () => 1;
    expect(validateContent(d).errors.some((e) => e.code === "non-json-value")).toBe(true);
    const d2: any = doc(p(t("x")));
    d2.root.children[0].date = new Date();
    expect(validateContent(d2).errors.some((e) => e.code === "non-json-value")).toBe(true);
    const d3: any = JSON.parse('{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[],"__proto__":{"polluted":true}}]}}');
    const r3 = validateContent(d3);
    expect(r3.errors.some((e) => e.code === "forbidden-key")).toBe(true);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("survives cyclic input without hanging", () => {
    const d: any = doc(p(t("x")));
    d.root.children[0].children.push(d.root);
    const r = validateContent(d);
    expect(r.ok).toBe(false);
  });

  it("warns about misplaced nodes (stray inline at root, text under list)", () => {
    const r = validateContent(doc(t("loose text"), { type: "list", version: 1, listType: "bullet", start: 1, tag: "ul", children: [p(t("x"))] } as any));
    expect(r.ok).toBe(true);
    expect(r.warnings.filter((w) => w.code === "misplaced-node").length).toBeGreaterThanOrEqual(2);
  });

  it("warns on newer node versions", () => {
    const d: any = doc(p(t("x")));
    d.root.children[0].version = 7;
    const r = validateContent(d);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.code === "newer-node-version")).toBe(true);
  });
});

describe("parseContent (tolerant)", () => {
  it("never throws and always returns a document", () => {
    for (const input of [undefined, null, 1, "x", [], {}, { root: null }, { root: { type: "root" } }, "{", JSON.stringify({ root: 1 })]) {
      const r = parseContent(input);
      expect(r.valid).toBe(false);
      expect(r.content.root.type).toBe("root");
      expect(Array.isArray(r.content.root.children)).toBe(true);
    }
  });

  it("parses a JSON string", () => {
    const r = parseContent(JSON.stringify(kitchenSink));
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("round-trips known documents unchanged", () => {
    const r = parseContent(editorSample);
    expect(r.valid).toBe(true);
    // compare through JSON to ignore undefined fields
    expect(JSON.parse(JSON.stringify(r.content))).toEqual(JSON.parse(JSON.stringify(editorSample)));
  });

  it("preserves unknown nodes and unknown properties verbatim", () => {
    const unknown = { type: "poll", version: 3, question: "Tabs or spaces?", options: [{ id: 1, label: "tabs" }], extra: { nested: true } };
    const d: any = doc(p(t("keep me")), unknown);
    d.root.children[0].futureProp = { a: 1 };
    const r = parseContent(d);
    expect(r.warnings.some((w) => w.code === "unknown-node-type")).toBe(true);
    const kept = r.content.root.children[1] as any;
    expect(kept).toMatchObject(unknown);
    expect((r.content.root.children[0] as any).futureProp).toEqual({ a: 1 });
  });

  it("preserves unknown element nodes' children recursively", () => {
    const r = parseContent(doc({ type: "callout", version: 1, children: [p(t("inside", 1))] }));
    const c: any = r.content.root.children[0];
    expect(c.children[0].children[0].text).toBe("inside");
  });

  it("repairs invalid optional attributes with defaults", () => {
    const d: any = doc(p({ ...t("x"), format: "bold", style: 5 }));
    d.root.children[0].indent = "lots";
    const r = parseContent(d);
    const para: any = r.content.root.children[0];
    expect(para.indent).toBe(0);
    expect(para.children[0].format).toBe(0);
    expect(para.children[0].style).toBe("");
  });

  it("fills in defaults for sparse hand-written nodes", () => {
    const r = parseContent({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "hi" }] }] } });
    expect(r.valid).toBe(true);
    const para: any = r.content.root.children[0];
    expect(para.version).toBe(1);
    expect(para.children[0]).toMatchObject({ text: "hi", format: 0, style: "" });
  });

  it("derives list `tag` from listType rather than trusting stored data", () => {
    const r = parseContent(doc({ type: "list", version: 1, listType: "number", tag: "ul", start: 1, children: [li1()] }));
    expect((r.content.root.children[0] as any).tag).toBe("ol");
  });

  it("drops leaf nodes with invalid required attributes and unwraps broken elements", () => {
    const r = parseContent(doc({ type: "youtube", version: 1, videoID: "!!" }, { ...h("h1", "kept text"), tag: "nope" }));
    expect(r.warnings.filter((w) => w.code === "invalid-attribute")).toHaveLength(2);
    // youtube dropped; broken heading unwrapped to its inline children
    expect(r.content.root.children.map((c) => c.type)).toEqual(["text"]);
  });

  it("stops at the node budget with a warning", () => {
    const r = parseContent(doc(...Array.from({ length: 50 }, () => p(t("x")))), { maxNodes: 20 });
    expect(r.valid).toBe(false);
    expect(r.warnings.some((w) => w.code === "max-nodes")).toBe(true);
    expect(r.stats.nodes).toBeLessThanOrEqual(21);
  });

  it("drops over-deep subtrees with a warning", () => {
    let node: any = p(t("deep"));
    for (let i = 0; i < 80; i++) node = { type: "wrapper", version: 1, children: [node] };
    const r = parseContent(doc(node));
    expect(r.warnings.some((w) => w.code === "max-depth")).toBe(true);
  });

  it("is idempotent: parsing a parsed tree returns it unchanged", () => {
    const first = parseContent(kitchenSink).content;
    const second = parseContent(first);
    expect(second.content).toBe(first);
    expect(second.warnings).toEqual([]);
  });

  it("parses image captions as nested documents", () => {
    const r = parseContent(doc(p({ type: "image", version: 1, src: "https://a/b.png", altText: "a", width: 0, height: 0, maxWidth: 500, showCaption: true, caption: { editorState: { root: { type: "root", version: 1, children: [p(t("cap"))] } } } })));
    const img: any = (r.content.root.children[0] as any).children[0];
    expect(img.caption.editorState.root.children[0].children[0].text).toBe("cap");
  });

  it("ignores malformed captions with a warning", () => {
    const r = parseContent(doc(p({ type: "image", version: 1, src: "https://a/b.png", altText: "a", width: 0, height: 0, maxWidth: 500, showCaption: true, caption: "oops" })));
    expect(r.warnings.some((w) => w.code === "invalid-attribute")).toBe(true);
    expect(((r.content.root.children[0] as any).children[0] as any).caption).toBeUndefined();
  });
});

function li1() {
  return el("listitem", [t("x")], { value: 1 });
}
