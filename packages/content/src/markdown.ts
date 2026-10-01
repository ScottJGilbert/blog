/**
 * Small Markdown → BCF converter used by seeds and tests. Supports: ATX/setext headings, paragraphs, hard breaks,
 * **bold**, *italic*, ~~strike~~, `code`, [links](url), <autolinks>, bare URLs, images (standalone or inline),
 * nested bullet/ordered/task lists, blockquotes, fenced code blocks, horizontal rules.
 * It is deliberately not a full CommonMark implementation.
 */
import { parseContent } from "./parse";
import { TEXT_FORMAT } from "./constants";
import type { Content, ContentNode } from "./types";

type Raw = Record<string, unknown>;

const text = (t: string, format = 0): Raw => ({ detail: 0, format, mode: "normal", style: "", text: t, type: "text", version: 1 });
const linebreak = (): Raw => ({ type: "linebreak", version: 1 });
const tab = (): Raw => ({ detail: 2, format: 0, mode: "normal", style: "", text: "\t", type: "tab", version: 1 });
const element = (type: string, children: Raw[], extra: Raw = {}): Raw => ({
  children,
  direction: "ltr",
  format: "",
  indent: 0,
  type,
  version: 1,
  ...extra,
});
const paragraph = (children: Raw[]): Raw => element("paragraph", children, { textFormat: 0, textStyle: "" });
const link = (url: string, children: Raw[], title?: string): Raw =>
  element("link", children, { rel: null, target: null, title: title ?? null, url });
const image = (src: string, alt: string, title?: string): Raw => {
  const hasCaption = !!title;
  return {
    type: "image",
    version: 1,
    src,
    altText: alt,
    width: 0,
    height: 0,
    maxWidth: 500,
    showCaption: hasCaption,
    caption: {
      editorState: {
        root: {
          children: hasCaption ? [paragraph([text(title!)])] : [],
          direction: null,
          format: "",
          indent: 0,
          type: "root",
          version: 1,
        },
      },
    },
  };
};

/* ------------------------------ inline ------------------------------ */

const PUNCT = /[!-/:-@[-`{-~]/;
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

function findClosing(src: string, open: number, close: string, openCh: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseLinkTarget(src: string, parenStart: number): { url: string; title?: string; end: number } | null {
  const close = findClosing(src, parenStart, ")", "(");
  if (close === -1) return null;
  const inner = src.slice(parenStart + 1, close).trim();
  const m = /^<?([^\s>]*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?$/.exec(inner);
  if (!m) return null;
  return { url: m[1] ?? "", title: m[2] ?? m[3], end: close };
}

export function parseInline(src: string, fmt = 0): Raw[] {
  const out: Raw[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(text(buf, fmt));
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;

    // escapes
    if (ch === "\\" && i + 1 < src.length) {
      if (src[i + 1] === "\n") {
        flush();
        out.push(linebreak());
        i += 2;
        continue;
      }
      if (PUNCT.test(src[i + 1]!)) {
        buf += src[i + 1];
        i += 2;
        continue;
      }
    }

    // hard line break (two trailing spaces + newline)
    if (ch === "\n") {
      flush();
      out.push(linebreak());
      i += 1;
      continue;
    }

    // code span
    if (ch === "`") {
      let run = 0;
      while (src[i + run] === "`") run++;
      const fence = "`".repeat(run);
      const end = src.indexOf(fence, i + run);
      if (end !== -1) {
        flush();
        let code = src.slice(i + run, end);
        if (code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
        out.push(text(code, fmt | TEXT_FORMAT.code));
        i = end + run;
        continue;
      }
      buf += fence;
      i += run;
      continue;
    }

    // image
    if (ch === "!" && src[i + 1] === "[") {
      const close = findClosing(src, i + 1, "]", "[");
      if (close !== -1 && src[close + 1] === "(") {
        const target = parseLinkTarget(src, close + 1);
        if (target) {
          flush();
          out.push(image(target.url, src.slice(i + 2, close), target.title));
          i = target.end + 1;
          continue;
        }
      }
    }

    // link
    if (ch === "[") {
      const close = findClosing(src, i, "]", "[");
      if (close !== -1 && src[close + 1] === "(") {
        const target = parseLinkTarget(src, close + 1);
        if (target) {
          flush();
          out.push(link(target.url, parseInline(src.slice(i + 1, close), fmt), target.title));
          i = target.end + 1;
          continue;
        }
      }
    }

    // <autolink>
    if (ch === "<") {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(src.slice(i));
      if (m) {
        flush();
        out.push(element("autolink", [text(m[1]!, fmt)], { rel: null, target: null, title: null, url: m[1], isUnlinked: false }));
        i += m[0].length;
        continue;
      }
    }

    // bare URL
    if (ch === "h" && !isWordChar(src[i - 1])) {
      const m = /^https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"*_~]/.exec(src.slice(i));
      if (m) {
        flush();
        out.push(element("autolink", [text(m[0], fmt)], { rel: null, target: null, title: null, url: m[0], isUnlinked: false }));
        i += m[0].length;
        continue;
      }
    }

    // strikethrough
    if (ch === "~" && src[i + 1] === "~") {
      const end = src.indexOf("~~", i + 2);
      if (end > i + 2) {
        flush();
        out.push(...parseInline(src.slice(i + 2, end), fmt | TEXT_FORMAT.strikethrough));
        i = end + 2;
        continue;
      }
    }

    // emphasis
    if ((ch === "*" || ch === "_") && src[i + 1] !== " " ) {
      let run = 0;
      while (src[i + run] === ch) run++;
      const prev = src[i - 1];
      const canOpen = ch === "*" || !isWordChar(prev);
      if (canOpen) {
        let done = false;
        for (let m = Math.min(run, 3); m >= 1 && !done; m--) {
          const j = findEmphasisClose(src, ch, m, i + run);
          if (j !== -1) {
            const start = i + run; // content starts after the whole opening run
            // opening run longer than m: leading extra markers stay literal text
            if (run > m) buf += ch.repeat(run - m);
            const inner = src.slice(start, j);
            flush();
            const bits = m === 1 ? TEXT_FORMAT.italic : m === 2 ? TEXT_FORMAT.bold : TEXT_FORMAT.bold | TEXT_FORMAT.italic;
            out.push(...parseInline(inner, fmt | bits));
            i = j + m;
            done = true;
          }
        }
        if (done) continue;
      }
      buf += ch.repeat(run);
      i += run;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush();
  return mergeText(out);
}

function findEmphasisClose(src: string, ch: string, m: number, contentStart: number): number {
  for (let j = contentStart; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "`") {
      // skip code spans
      let run = 0;
      while (src[j + run] === "`") run++;
      const end = src.indexOf("`".repeat(run), j + run);
      if (end !== -1) j = end + run - 1;
      continue;
    }
    if (src[j] !== ch) continue;
    let run = 0;
    while (src[j + run] === ch) run++;
    const before = src[j - 1];
    if (run >= m && before !== " " && before !== "\n" && j > contentStart) {
      const after = src[j + m];
      if (ch === "_" && isWordChar(after)) {
        j += run - 1;
        continue;
      }
      // nested shorter markers (e.g. `*a **b** c*`): a longer run than m only closes when it is the final run
      if (run > m && m === 1 && run >= 2) {
        // treat as nested strong; skip over it
        j += run - 1;
        continue;
      }
      return j + (run - m);
    }
    j += run - 1;
  }
  return -1;
}

function mergeText(nodes: Raw[]): Raw[] {
  const out: Raw[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && last.type === "text" && n.type === "text" && last.format === n.format) {
      last.text = (last.text as string) + (n.text as string);
    } else out.push(n);
  }
  return out;
}

/* ------------------------------ blocks ------------------------------ */

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)\s*$/;

interface ListEntry {
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
  checked?: boolean;
  task: boolean;
}

function codeBlock(lines: string[], lang: string): Raw {
  const children: Raw[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) children.push(linebreak());
    const parts = line.split("\t");
    parts.forEach((part, pi) => {
      if (pi > 0) children.push(tab());
      if (part) children.push({ detail: 0, format: 0, mode: "normal", style: "", text: part, type: "code-highlight", version: 1 });
    });
  });
  return element("code", children, lang ? { language: lang } : {});
}

function buildList(entries: ListEntry[], pos: { i: number }, depth: number, indent: number): Raw {
  const first = entries[pos.i]!;
  const listType = first.task ? "check" : first.ordered ? "number" : "bullet";
  const items: Raw[] = [];
  let value = first.ordered ? first.start : 1;
  while (pos.i < entries.length) {
    const e = entries[pos.i]!;
    if (e.indent < indent) break;
    if (e.indent > indent) {
      // nested list belongs to the previous item
      const nestedListNode = buildList(entries, pos, depth + 1, e.indent);
      items.push(element("listitem", [nestedListNode], { value, indent: depth + 1 }));
      continue;
    }
    items.push(
      element("listitem", parseInline(e.text), {
        value,
        ...(listType === "check" ? { checked: !!e.checked } : {}),
        indent: depth,
      }),
    );
    value += 1;
    pos.i += 1;
  }
  return element("list", items, {
    listType,
    start: first.ordered ? first.start : 1,
    tag: listType === "number" ? "ol" : "ul",
  });
}

/** Convert Markdown text into a BCF document. */
export function markdownToContent(md: string): Content {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Raw[] = [];
  let i = 0;

  const startsBlock = (line: string): boolean =>
    FENCE.test(line) || ATX.test(line) || HR.test(line) || LIST_ITEM.test(line) || QUOTE.test(line);

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }

    // fenced code
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      blocks.push(codeBlock(body, lang));
      continue;
    }

    // ATX heading
    const atx = ATX.exec(line);
    if (atx) {
      blocks.push(element("heading", parseInline((atx[2] ?? "").trim()), { tag: `h${atx[1]!.length}` }));
      i++;
      continue;
    }

    // hr
    if (HR.test(line)) {
      blocks.push({ type: "horizontalrule", version: 1 });
      i++;
      continue;
    }

    // blockquote
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        inner.push(QUOTE.exec(lines[i]!)![1]!);
        i++;
      }
      let para: string[] = [];
      const flush = () => {
        if (para.length) blocks.push(element("quote", parseInline(para.join("\n").replace(/\n/g, " ").trim())));
        para = [];
      };
      for (const l of inner) {
        if (l.trim() === "") flush();
        else para.push(l);
      }
      flush();
      continue;
    }

    // list
    if (LIST_ITEM.test(line)) {
      const entries: ListEntry[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const m = LIST_ITEM.exec(l);
        if (m && !HR.test(l)) {
          const indent = m[1]!.replace(/\t/g, "    ").length;
          let body = m[3]!;
          let task = false;
          let checked = false;
          const t = /^\[( |x|X)\]\s+(.*)$/.exec(body);
          if (t && !/^\d/.test(m[2]!)) {
            task = true;
            checked = t[1] !== " ";
            body = t[2]!;
          }
          const ordered = /^\d/.test(m[2]!);
          entries.push({ indent, ordered, start: ordered ? parseInt(m[2]!, 10) : 1, text: body, task, checked });
          i++;
        } else if (l.trim() !== "" && /^\s+\S/.test(l) && entries.length && !startsBlock(l.trim())) {
          // continuation line
          entries[entries.length - 1]!.text += `\n${l.trim()}`;
          i++;
        } else if (l.trim() === "" && i + 1 < lines.length && LIST_ITEM.test(lines[i + 1]!)) {
          i++; // loose list
        } else break;
      }
      // normalise indents to levels
      const indents = [...new Set(entries.map((e) => e.indent))].sort((a, b) => a - b);
      const norm = entries.map((e) => ({ ...e, indent: indents.indexOf(e.indent) }));
      const pos = { i: 0 };
      while (pos.i < norm.length) blocks.push(buildList(norm, pos, 0, 0));
      continue;
    }

    // paragraph (with setext heading support)
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      const l = lines[i]!;
      if (para.length && /^ {0,3}=+\s*$/.test(l)) {
        blocks.push(element("heading", parseInline(para.join(" ").trim()), { tag: "h1" }));
        para.length = 0;
        i++;
        break;
      }
      if (para.length && /^ {0,3}-+\s*$/.test(l)) {
        blocks.push(element("heading", parseInline(para.join(" ").trim()), { tag: "h2" }));
        para.length = 0;
        i++;
        break;
      }
      if (para.length && startsBlock(l)) break;
      para.push(l);
      i++;
    }
    if (para.length) {
      // soft line breaks become spaces; two trailing spaces or a backslash make a hard break
      const hard = para
        .map((l, idx) => {
          if (idx === para.length - 1) return l.trim();
          return /( {2,}|\\)$/.test(l) ? `${l.replace(/ {2,}$/, "").replace(/\\$/, "").trimStart()}\n` : `${l.trim()} `;
        })
        .join("");
      const imageOnly = IMAGE_ONLY.exec(hard.trim());
      if (imageOnly && para.length === 1) {
        blocks.push(paragraph([image(imageOnly[2]!, imageOnly[1]!, imageOnly[3] ?? imageOnly[4])]));
      } else {
        blocks.push(paragraph(parseInline(hard)));
      }
    }
  }

  const raw = {
    root: {
      children: blocks.length ? blocks : [paragraph([])],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
  // normalise through the tolerant parser so the output is guaranteed well-formed (and marked as parsed)
  return parseContent(raw).content;
}

export type { ContentNode };
