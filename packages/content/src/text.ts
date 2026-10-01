/**
 * Plain-text derivations: toPlainText, toExcerpt, readingMinutes, isContentEmpty, extractImages.
 */
import { isParsedContent, parseContent } from "./parse";
import { formatDateTime } from "./datetime";
import type {
  CodeNode,
  Content,
  ContentInput,
  ContentNode,
  DateTimeNode,
  EquationNode,
  ImageNode,
  ListNode,
  TextNode as BcfTextNode,
} from "./types";

/** Parse `input` unless it already is a parsed tree. */
export function ensureContent(input: ContentInput): Content {
  return isParsedContent(input) ? input : parseContent(input).content;
}

export interface PlainTextOptions {
  /** Prefix list items with `- `, `1. `, `[ ] `/`[x] ` (default false: friendlier for search/word counts). */
  markers?: boolean;
  /** Include the URLs of YouTube/Figma/Tweet embeds as lines of text (default false). */
  embedUrls?: boolean;
  /** Skip headings (used by excerpts). */
  skipHeadings?: boolean;
}

const BLOCK_SEP = "\n\n";

type N = ContentNode & Record<string, unknown>;
const kids = (n: ContentNode): ContentNode[] => (Array.isArray((n as { children?: unknown }).children) ? ((n as { children: ContentNode[] }).children) : []);

/** Inline text of a node's children (no block separators). */
export function inlineText(node: ContentNode): string {
  let out = "";
  for (const c of kids(node)) out += inlineNodeText(c);
  return out;
}

function inlineNodeText(node: ContentNode): string {
  const n = node as N;
  switch (n.type) {
    case "text":
    case "hashtag":
    case "keyword":
    case "specialText":
    case "mention":
    case "emoji":
    case "tab":
    case "code-highlight":
      return typeof n.text === "string" ? (n.text as string) : "";
    case "linebreak":
      return "\n";
    case "equation":
      return (node as EquationNode).equation;
    case "datetime":
      return formatDateTime((node as DateTimeNode).dateTime);
    case "image":
      return (node as ImageNode).altText || "";
    case "link":
    case "autolink":
    case "mark":
    case "overflow":
      return inlineText(node);
    default:
      return "";
  }
}

function imageCaptionText(node: ImageNode): string {
  if (!node.showCaption || !node.caption) return "";
  const parts: string[] = [];
  for (const c of node.caption.editorState.root.children) {
    const t = inlineText(c).trim();
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

interface Block {
  text: string;
  /** blocks with the same non-zero group (lines of one list / rows of one table) are joined with a single newline */
  group?: number;
}

let groupCounter = 0;

function pushText(out: Block[], text: string): void {
  const t = text.trim();
  if (t !== "") out.push({ text: t });
}

/** Block-level plain text: one entry per block (list line / table row are "tight"). */
function collectBlocks(nodes: ContentNode[], out: Block[], opts: PlainTextOptions): void {
  let inlineRun = "";
  const flush = () => {
    pushText(out, inlineRun);
    inlineRun = "";
  };
  for (const node of nodes) {
    const n = node as N;
    switch (n.type) {
      case "paragraph":
      case "quote":
        flush();
        collectInlineBlock(node, out);
        break;
      case "heading":
        flush();
        if (!opts.skipHeadings) pushText(out, inlineText(node));
        break;
      case "code":
        flush();
        pushText(out, codeText(node as CodeNode));
        break;
      case "list":
        flush();
        collectList(node as ListNode, out, opts, 0, ++groupCounter);
        break;
      case "table":
        flush();
        collectTable(node, out, opts);
        break;
      case "layout-container":
      case "layout-item":
      case "collapsible-container":
      case "collapsible-title":
      case "collapsible-content":
        flush();
        collectBlocks(kids(node), out, opts);
        break;
      case "equation":
        if ((node as EquationNode).inline) inlineRun += (node as EquationNode).equation;
        else {
          flush();
          pushText(out, (node as EquationNode).equation);
        }
        break;
      case "youtube":
        flush();
        if (opts.embedUrls && typeof n.videoID === "string") pushText(out, `https://www.youtube.com/watch?v=${n.videoID}`);
        break;
      case "figma":
        flush();
        if (opts.embedUrls && typeof n.documentID === "string") pushText(out, `https://www.figma.com/file/${n.documentID}`);
        break;
      case "tweet":
        flush();
        if (opts.embedUrls && typeof n.id === "string") pushText(out, `https://x.com/i/web/status/${n.id}`);
        break;
      case "horizontalrule":
      case "page-break":
        flush();
        break;
      case "image":
        flush();
        pushText(out, (node as ImageNode).altText ?? "");
        pushText(out, imageCaptionText(node as ImageNode));
        break;
      default:
        // inline-level node in block position
        if (INLINE.has(n.type as string)) inlineRun += inlineNodeText(node);
        break;
    }
  }
  flush();
}

const INLINE = new Set(["text", "linebreak", "tab", "hashtag", "keyword", "specialText", "mention", "emoji", "code-highlight", "link", "autolink", "mark", "overflow", "datetime"]);

/** Text of a paragraph-like block; captions of images inside it become extra blocks after it. */
function collectInlineBlock(node: ContentNode, out: Block[]): void {
  let text = "";
  const captions: string[] = [];
  const visit = (children: ContentNode[]) => {
    for (const c of children) {
      const t = (c as N).type;
      if (t === "image") {
        text += (c as ImageNode).altText ?? "";
        const cap = imageCaptionText(c as ImageNode);
        if (cap) captions.push(cap);
      } else if (t === "link" || t === "autolink" || t === "mark" || t === "overflow") {
        visit(kids(c));
      } else {
        text += inlineNodeText(c);
      }
    }
  };
  visit(kids(node));
  pushText(out, text);
  for (const cap of captions) pushText(out, cap);
}

function codeText(node: CodeNode): string {
  let out = "";
  for (const c of kids(node)) {
    const n = c as N;
    if (n.type === "linebreak") out += "\n";
    else if (typeof n.text === "string") out += n.text as string;
  }
  return out;
}

function collectList(list: ListNode, out: Block[], opts: PlainTextOptions, depth: number, group: number): void {
  let index = typeof list.start === "number" ? list.start : 1;
  for (const item of list.children) {
    if ((item as N).type !== "listitem") continue;
    const nested = kids(item).filter((c) => (c as N).type === "list");
    const text = kids(item)
      .filter((c) => (c as N).type !== "list")
      .map((c) => inlineNodeText(c))
      .join("")
      .replace(/\s*\n\s*/g, " ")
      .trim();
    if (text) {
      let marker = "";
      if (opts.markers) {
        const indent = "  ".repeat(depth);
        if (list.listType === "number") marker = `${indent}${index}. `;
        else if (list.listType === "check") marker = `${indent}${(item as { checked?: boolean }).checked ? "[x]" : "[ ]"} `;
        else marker = `${indent}- `;
      }
      out.push({ text: `${marker}${text}`, group });
      index += 1;
    }
    for (const n of nested) collectList(n as ListNode, out, opts, depth + 1, group);
  }
}

function collectTable(table: ContentNode, out: Block[], opts: PlainTextOptions): void {
  const group = ++groupCounter;
  for (const row of kids(table)) {
    if ((row as N).type !== "tablerow") continue;
    const cells: string[] = [];
    for (const cell of kids(row)) {
      if ((cell as N).type !== "tablecell") continue;
      const parts: Block[] = [];
      collectBlocks(kids(cell), parts, { ...opts, markers: false });
      cells.push(parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim());
    }
    if (cells.some((c) => c !== "")) out.push({ text: cells.join(" | "), group });
  }
}

/**
 * Plain text of a document. Blocks are separated by a blank line; list items and table rows by a single
 * newline; decorative nodes (rules, page breaks, embeds, unknown nodes) are skipped; images contribute alt
 * text and captions.
 */
export function toPlainText(content: ContentInput, opts: PlainTextOptions = {}): string {
  const doc = ensureContent(content);
  const blocks: Block[] = [];
  collectBlocks(doc.root.children, blocks, opts);
  let out = "";
  blocks.forEach((b, i) => {
    if (i > 0) out += b.group && b.group === blocks[i - 1]!.group ? "\n" : BLOCK_SEP;
    out += b.text;
  });
  return out;
}

/**
 * Excerpt of at most `maxChars` characters: leading paragraph text (headings skipped when other text exists),
 * whitespace collapsed, cut on a word boundary with an ellipsis.
 */
export function toExcerpt(content: ContentInput, maxChars = 200): string {
  const doc = ensureContent(content);
  let text = toPlainText(doc, { skipHeadings: true });
  if (text.trim() === "") text = toPlainText(doc);
  text = text.replace(/\s+/g, " ").trim();
  return truncateAtWord(text, maxChars);
}

export function truncateAtWord(text: string, maxChars: number): string {
  const max = Math.max(1, Math.floor(maxChars));
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max === 1) return "…";
  const budget = max - 1; // room for the ellipsis
  let cut = chars.slice(0, budget).join("");
  const nextIsBreak = /\s/.test(chars[budget] ?? "");
  if (!nextIsBreak) {
    const lastSpace = cut.search(/\s\S*$/);
    // only back up to a word boundary when that does not throw away most of the excerpt
    if (lastSpace > budget * 0.5) cut = cut.slice(0, lastSpace);
  }
  cut = cut.replace(/[\s,;:\-–—(\[{"'“‘]+$/u, "");
  return `${cut}…`;
}

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/gu;

/** Number of words (CJK characters count as half a word each). */
export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.replace(CJK, " ").match(WORD)?.length ?? 0;
  return latin + Math.ceil(cjk / 2);
}

/** Estimated reading time in whole minutes (minimum 1). */
export function readingMinutes(content: ContentInput, wpm = 220): number {
  const doc = ensureContent(content);
  const words = countWords(toPlainText(doc));
  const perMinute = wpm > 0 && Number.isFinite(wpm) ? wpm : 220;
  return Math.max(1, Math.ceil(words / perMinute));
}

/** True when the document has no text and no media/embeds. */
export function isContentEmpty(content: ContentInput): boolean {
  const doc = ensureContent(content);
  const stack: ContentNode[] = [...doc.root.children];
  while (stack.length) {
    const n = stack.pop() as N;
    switch (n.type) {
      case "text":
      case "hashtag":
      case "keyword":
      case "specialText":
      case "mention":
      case "emoji":
      case "code-highlight":
        if (typeof n.text === "string" && (n.text as string).trim() !== "") return false;
        break;
      case "image":
      case "equation":
      case "youtube":
      case "tweet":
      case "figma":
      case "datetime":
        return false;
      default:
        break;
    }
    for (const c of kids(n)) stack.push(c);
  }
  return true;
}

export interface ExtractedImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
}

/** All images in document order (useful for cover/OG image selection and media clean-up). */
export function extractImages(content: ContentInput): ExtractedImage[] {
  const doc = ensureContent(content);
  const out: ExtractedImage[] = [];
  const visit = (nodes: ContentNode[]) => {
    for (const node of nodes) {
      const n = node as N;
      if (n.type === "image") {
        const img = node as ImageNode;
        out.push({ src: img.src, alt: img.altText ?? "", width: img.width || 0, height: img.height || 0, caption: imageCaptionText(img) });
      } else {
        visit(kids(node));
      }
    }
  };
  visit(doc.root.children);
  return out;
}

export type { BcfTextNode };
