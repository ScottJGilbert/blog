/**
 * Table of contents + heading ids. `renderHtml` uses the SAME function to assign `id`s, so
 * `extractToc(c)[i].id` is always the id of the i-th (non-empty) heading in the rendered HTML.
 */
import { SlugAllocator } from "./slug";
import { ensureContent, inlineText } from "./text";
import type { Content, ContentInput, ContentNode, HeadingNode, TocEntry } from "./types";

export interface TocOptions {
  /** Prefix for every id, e.g. `"h-"`. Must be the same value passed to `renderHtml({ headingIdPrefix })`. */
  idPrefix?: string;
}

export interface HeadingInfo {
  id: string;
  text: string;
  level: TocEntry["level"];
}

/** Every heading in document order (including those inside layouts, collapsibles and table cells). */
export function collectHeadings(doc: Content, idPrefix = ""): Map<ContentNode, HeadingInfo> {
  const alloc = new SlugAllocator(idPrefix);
  const out = new Map<ContentNode, HeadingInfo>();
  const visit = (nodes: ContentNode[]) => {
    for (const node of nodes) {
      if ((node as { type: string }).type === "heading") {
        const h = node as HeadingNode;
        const text = inlineText(node).replace(/\s+/g, " ").trim();
        const level = Number(String(h.tag).slice(1)) as TocEntry["level"];
        out.set(node, { id: alloc.next(text), text, level });
      }
      const children = (node as { children?: unknown }).children;
      if (Array.isArray(children)) visit(children as ContentNode[]);
    }
  };
  visit(doc.root.children);
  return out;
}

/** Headings with stable, unique slug ids. Headings without text are omitted. */
export function extractToc(content: ContentInput, opts: TocOptions = {}): TocEntry[] {
  const doc = ensureContent(content);
  const out: TocEntry[] = [];
  for (const info of collectHeadings(doc, opts.idPrefix ?? "").values()) {
    if (info.text !== "") out.push({ id: info.id, text: info.text, level: info.level });
  }
  return out;
}
