/** Tiny builders that produce exactly the JSON shapes Lexical 0.40 / the editor package serialize. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type J = Record<string, any>;

export const F = { bold: 1, italic: 2, strike: 4, underline: 8, code: 16, sub: 32, sup: 64, highlight: 128, lower: 256, upper: 512, cap: 1024 };

export const t = (text: string, format = 0, style = ""): J => ({ detail: 0, format, mode: "normal", style, text, type: "text", version: 1 });
export const br = (): J => ({ type: "linebreak", version: 1 });
export const tab = (): J => ({ detail: 2, format: 0, mode: "normal", style: "", text: "\t", type: "tab", version: 1 });

export const el = (type: string, children: J[], extra: J = {}): J => ({
  children,
  direction: "ltr",
  format: "",
  indent: 0,
  type,
  version: 1,
  ...extra,
});
export const p = (...children: J[]): J => el("paragraph", children, { textFormat: 0, textStyle: "" });
export const h = (tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6", ...children: (J | string)[]): J =>
  el("heading", children.map((c) => (typeof c === "string" ? t(c) : c)), { tag });
export const quote = (...children: J[]): J => el("quote", children);
export const a = (url: string, ...children: J[]): J => el("link", children, { rel: null, target: null, title: null, url });
export const auto = (url: string): J => el("autolink", [t(url)], { rel: null, target: null, title: null, url, isUnlinked: false });
export const li = (children: J[], extra: J = {}): J => el("listitem", children, { value: 1, ...extra });
export const ul = (...items: J[]): J => el("list", items, { listType: "bullet", start: 1, tag: "ul" });
export const ol = (...items: J[]): J => el("list", items, { listType: "number", start: 1, tag: "ol" });
export const checklist = (...items: J[]): J => el("list", items, { listType: "check", start: 1, tag: "ul" });
export const code = (language: string | undefined, ...children: J[]): J => el("code", children, { language, theme: undefined });
export const tok = (text: string, highlightType?: string, style = ""): J => ({ detail: 0, format: 0, mode: "normal", style, text, type: "code-highlight", version: 1, ...(highlightType ? { highlightType } : {}) });
export const hr = (): J => ({ type: "horizontalrule", version: 1 });
export const cell = (children: J[], extra: J = {}): J =>
  el("tablecell", children, { backgroundColor: null, colSpan: 1, headerState: 0, rowSpan: 1, ...extra });
export const tr = (...cells: J[]): J => el("tablerow", cells);
export const table = (rows: J[], extra: J = {}): J => el("table", rows, extra);
export const root = (children: J[]): J => el("root", children, { direction: "ltr" });
export const doc = (...children: J[]): J => ({ root: root(children) });

export const image = (src: string, altText = "", extra: J = {}, captionText?: string): J => ({
  type: "image",
  version: 1,
  src,
  altText,
  width: 0,
  height: 0,
  maxWidth: 500,
  showCaption: captionText !== undefined,
  caption: {
    editorState: {
      root: root(captionText !== undefined ? [p(t(captionText))] : []),
    },
  },
  ...extra,
});
export const equation = (eq: string, inline = false): J => ({ type: "equation", version: 1, equation: eq, inline });
export const youtube = (videoID: string, format = ""): J => ({ type: "youtube", version: 1, format, videoID });
export const tweet = (id: string, format = ""): J => ({ type: "tweet", version: 1, format, id });
export const figma = (documentID: string, format = ""): J => ({ type: "figma", version: 1, format, documentID });
export const datetime = (dateTime: string): J => ({ type: "datetime", version: 1, dateTime });
export const layout = (templateColumns: string, ...items: J[][]): J =>
  el("layout-container", items.map((blocks) => el("layout-item", blocks)), { templateColumns });
export const collapsible = (title: string, body: J[], open = true): J =>
  el("collapsible-container", [el("collapsible-title", [t(title)]), el("collapsible-content", body)], { open });
export const hashtag = (text: string): J => ({ detail: 0, format: 0, mode: "normal", style: "", text, type: "hashtag", version: 1 });
export const emoji = (text: string, className = "emoji happysmile"): J => ({ detail: 0, format: 0, mode: "token", style: "", text, type: "emoji", version: 1, className });
export const mention = (name: string): J => ({ detail: 1, format: 0, mode: "segmented", style: "", text: name, type: "mention", version: 1, mentionName: name });
export const keyword = (text: string): J => ({ detail: 0, format: 0, mode: "normal", style: "", text, type: "keyword", version: 1 });
export const special = (text: string): J => ({ detail: 0, format: 0, mode: "normal", style: "", text, type: "specialText", version: 1 });
export const mark = (ids: string[], ...children: J[]): J => el("mark", children, { ids });
export const overflow = (...children: J[]): J => el("overflow", children);
export const pageBreak = (): J => ({ type: "page-break", version: 1 });
