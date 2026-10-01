/**
 * Pure string HTML renderer for BCF v1 (no DOM, no jsdom).
 *
 * Targets:
 *  - web   : class names of the editor's `ViewerTheme.css`, allowlisted inline styles, details/iframes.
 *  - email : no class dependence, inline styles, table-safe layout, no iframes/details/scripts.
 *  - rss   : semantic HTML, absolute URLs, no classes/scripts/iframes.
 *
 * Security model: every string is escaped; URLs go through `sanitizeUrl`; CSS through `sanitizeStyle`;
 * iframe URLs are built from validated ids and checked against the host allowlist; unknown nodes are skipped.
 */
import {
  BCF_CLASS,
  INDENT_PX,
  MAX_INDENT,
  TEXT_FORMAT,
  TEXT_FORMAT_MASK,
  THEME,
} from "../constants";
import {
  CODE_STYLE_PROPS,
  isSafeColor,
  safeGridTemplateColumns,
  safePx,
  sanitizeStyle,
  stylePairsToString,
} from "../css";
import { formatDateTime, toIsoString } from "../datetime";
import { escapeAttr, escapeHtml, escapeText } from "../escape";
import { BLOCK_TYPES, isParsedContent, parseContent } from "../parse";
import { collectHeadings, type HeadingInfo } from "../toc";
import {
  absolutize,
  figmaEmbedUrl,
  figmaFileUrl,
  isAllowedEmbedUrl,
  sanitizeUrl,
  tweetEmbedUrl,
  tweetUrl,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "../url";
import type {
  CodeHighlightNode,
  CodeNode,
  CollapsibleContainerNode,
  Content,
  ContentInput,
  ContentIssue,
  ContentNode,
  DateTimeNode,
  EquationNode,
  FigmaNode,
  HeadingNode,
  ImageNode,
  LayoutContainerNode,
  LinkNode,
  ListItemNode,
  ListNode,
  RenderOptions,
  RenderResult,
  RenderTarget,
  TableCellNode,
  TableNode,
  TableRowNode,
  TweetNode,
  WarningCode,
  YouTubeNode,
} from "../types";
import { EMAIL } from "./email-styles";
import { renderKatex } from "./katex";

type N = ContentNode & Record<string, unknown>;

const kidsOf = (n: ContentNode): ContentNode[] => {
  const c = (n as { children?: unknown }).children;
  return Array.isArray(c) ? (c as ContentNode[]) : [];
};
const typeOf = (n: ContentNode): string => (n as { type: string }).type;

/* ------------------------------------------------------------------ */

class Renderer {
  readonly web: boolean;
  readonly email: boolean;
  readonly rss: boolean;
  readonly warnings: ContentIssue[] = [];
  private seen = new Set<string>();
  private headings: Map<ContentNode, HeadingInfo>;
  private listDepth = 0;
  private cellDepth = 0;

  constructor(
    private doc: Content,
    private opts: RenderOptions,
    readonly target: RenderTarget,
  ) {
    this.web = target === "web";
    this.email = target === "email";
    this.rss = target === "rss";
    let headings = new Map<ContentNode, HeadingInfo>();
    if (this.web) {
      try {
        headings = collectHeadings(doc, opts.headingIdPrefix ?? "");
      } catch (e) {
        this.warn("render-error", `could not assign heading ids: ${(e as Error).message}`);
      }
    }
    this.headings = headings;
  }

  /* ----------------------------- utils ----------------------------- */

  warn(code: WarningCode, message: string, nodeType?: string, key?: string): void {
    const k = `${code}:${key ?? message}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    const issue: ContentIssue = { code, message, path: "render", ...(nodeType ? { nodeType } : {}) };
    this.warnings.push(issue);
    this.opts.onWarning?.(issue);
  }

  private cls(...names: Array<string | false | null | undefined>): string {
    if (!this.web) return "";
    const v = names.filter(Boolean).join(" ");
    return v ? ` class="${escapeAttr(v)}"` : "";
  }

  private style(...parts: Array<string | false | null | undefined>): string {
    if (this.rss) return ""; // feed readers ignore/strip styles; keep the markup semantic
    const v = parts.filter(Boolean).join(";");
    return v ? ` style="${escapeAttr(v)}"` : "";
  }

  /** target-dependent inline style: only applied for email */
  private em(css: string): string | false {
    return this.email ? css : false;
  }

  private url(raw: unknown, opts: { image?: boolean } = {}) {
    return sanitizeUrl(raw, {
      baseUrl: this.opts.baseUrl,
      absolute: !this.web,
      allowDataImage: !!opts.image && this.web,
    });
  }

  /** `text-align` + indent + dir for block elements */
  private blockLayout(node: ContentNode, extraStyle: Array<string | false> = []): { dir: string; style: string } {
    const n = node as { format?: unknown; indent?: unknown; direction?: unknown };
    const parts: Array<string | false> = [...extraStyle];
    const fmt = typeof n.format === "string" ? n.format : "";
    if (fmt === "center" || fmt === "right" || fmt === "justify" || fmt === "end") parts.push(`text-align:${fmt}`);
    const indent = typeof n.indent === "number" ? Math.min(Math.max(0, Math.floor(n.indent)), MAX_INDENT) : 0;
    if (indent > 0) parts.push(this.email ? `margin-left:${indent * INDENT_PX}px` : `padding-inline-start:${indent * INDENT_PX}px`);
    const dir = n.direction === "rtl" ? ' dir="rtl"' : "";
    return { dir, style: this.style(...parts) };
  }

  /* ----------------------------- blocks ----------------------------- */

  renderRoot(): string {
    return this.blocks(this.doc.root.children);
  }

  /** Render nodes in block context: runs of inline nodes are wrapped in an implicit paragraph. */
  blocks(nodes: ContentNode[]): string {
    let out = "";
    let run: ContentNode[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const inner = this.inline(run);
      if (inner.trim() !== "") out += this.implicitParagraph(inner);
      run = [];
    };
    for (const node of nodes) {
      if (this.isInlineNode(node)) {
        run.push(node);
        continue;
      }
      flush();
      try {
        out += this.block(node);
      } catch (e) {
        this.warn("render-error", `failed to render <${typeOf(node)}>: ${(e as Error).message}`, typeOf(node));
      }
    }
    flush();
    return out;
  }

  private isInlineNode(node: ContentNode): boolean {
    const t = typeOf(node);
    if (t === "equation") return !!(node as EquationNode).inline;
    if (t === "image") return true;
    return (
      t === "text" ||
      t === "linebreak" ||
      t === "tab" ||
      t === "hashtag" ||
      t === "keyword" ||
      t === "specialText" ||
      t === "mention" ||
      t === "emoji" ||
      t === "code-highlight" ||
      t === "link" ||
      t === "autolink" ||
      t === "mark" ||
      t === "overflow" ||
      t === "datetime"
    );
  }

  block(node: ContentNode): string {
    switch (typeOf(node)) {
      case "paragraph":
        return this.paragraph(node);
      case "heading":
        return this.heading(node as HeadingNode);
      case "quote":
        return this.quote(node);
      case "list":
        return this.list(node as ListNode);
      case "code":
        return this.code(node as CodeNode);
      case "horizontalrule":
        return this.hr();
      case "page-break":
        return this.pageBreak();
      case "table":
        return this.table(node as TableNode);
      case "equation":
        return this.equation(node as EquationNode);
      case "youtube":
        return this.youtube(node as YouTubeNode);
      case "figma":
        return this.figma(node as FigmaNode);
      case "tweet":
        return this.tweet(node as TweetNode);
      case "layout-container":
        return this.layout(node as LayoutContainerNode);
      case "collapsible-container":
        return this.collapsible(node as CollapsibleContainerNode);
      case "layout-item":
      case "collapsible-content":
        // stray structural nodes: render their content
        return this.blocks(kidsOf(node));
      case "collapsible-title":
      case "listitem":
      case "tablerow":
      case "tablecell":
        return this.blocks(kidsOf(node));
      case "image":
      case "datetime":
        return this.implicitParagraph(this.inline([node]));
      case "root":
        return this.blocks(kidsOf(node));
      default:
        return this.unknown(node);
    }
  }

  private unknown(node: ContentNode): string {
    const t = typeOf(node);
    this.warn("unknown-node-type", `skipped unknown node type "${t}"`, t, t);
    if (this.opts.unknown === "unwrap") {
      const n = node as N;
      if (typeof n.text === "string") return this.implicitParagraph(escapeText(n.text as string));
      return this.blocks(kidsOf(node));
    }
    return "";
  }

  private implicitParagraph(inner: string): string {
    return `<p${this.cls(THEME.paragraph)}${this.style(this.em(EMAIL.p))}>${inner}</p>`;
  }

  private paragraph(node: ContentNode): string {
    const children = kidsOf(node);
    const inner = this.inline(children);
    const blockish = children.some((c) => {
      const t = typeOf(c);
      if (t === "image") return this.imageHasFigure(c as ImageNode);
      if (t === "equation") return !(c as EquationNode).inline;
      return t !== "equation" && BLOCK_TYPES.has(t);
    });
    const layout = this.blockLayout(node, [this.em(this.cellDepth > 0 ? EMAIL.pCell : EMAIL.p)]);
    if (blockish) {
      return `<div role="paragraph"${this.cls(THEME.paragraph)}${layout.dir}${layout.style}>${inner}</div>`;
    }
    return `<p${this.cls(THEME.paragraph)}${layout.dir}${layout.style}>${inner === "" ? "<br>" : inner}</p>`;
  }

  private heading(node: HeadingNode): string {
    const tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const).includes(node.tag) ? node.tag : "h2";
    const info = this.headings.get(node);
    const id = info ? ` id="${escapeAttr(info.id)}"` : "";
    const layout = this.blockLayout(node, [this.em(EMAIL.heading[tag])]);
    return `<${tag}${id}${this.cls(THEME.heading[tag])}${layout.dir}${layout.style}>${this.inline(kidsOf(node))}</${tag}>`;
  }

  private quote(node: ContentNode): string {
    const layout = this.blockLayout(node, [this.em(EMAIL.quote)]);
    return `<blockquote${this.cls(THEME.quote)}${layout.dir}${layout.style}>${this.inline(kidsOf(node))}</blockquote>`;
  }

  private hr(): string {
    return this.web
      ? `<hr class="${THEME.hr}">`
      : this.email
        ? `<hr style="${EMAIL.hr}">`
        : "<hr>";
  }

  private pageBreak(): string {
    if (this.web) return `<hr class="${BCF_CLASS.pageBreak}" aria-hidden="true">`;
    return this.hr();
  }

  /* ----------------------------- lists ----------------------------- */

  private list(list: ListNode): string {
    this.listDepth += 1;
    const depth = this.listDepth;
    try {
      const ordered = list.listType === "number";
      const check = list.listType === "check";
      const tag = ordered ? "ol" : "ul";
      const olClass = THEME.olDepth[Math.min(depth, THEME.olDepth.length) - 1];
      const classes = ordered ? olClass : check ? `${THEME.ul} ${THEME.checklist}` : THEME.ul;
      const start = ordered && typeof list.start === "number" && list.start !== 1 && list.start > 0 ? ` start="${list.start}"` : "";
      let index = typeof list.start === "number" ? list.start : 1;
      let items = "";
      for (const child of kidsOf(list)) {
        if (typeOf(child) !== "listitem") {
          // misplaced child: render what we can
          items += `<li${this.cls(THEME.listItem)}>${this.inline([child])}</li>`;
          continue;
        }
        const item = child as ListItemNode;
        const kids = kidsOf(item);
        const nestedOnly = kids.length > 0 && kids.every((k) => typeOf(k) === "list");
        items += this.listItem(item, list, nestedOnly ? null : index, check);
        if (!nestedOnly) index += 1;
      }
      const style = this.style(this.em(check ? EMAIL.ulCheck : EMAIL.list));
      return `<${tag}${this.cls(classes)}${start}${style}>${items}</${tag}>`;
    } finally {
      this.listDepth -= 1;
    }
  }

  private listItem(item: ListItemNode, list: ListNode, index: number | null, check: boolean): string {
    const kids = kidsOf(item);
    const nestedOnly = index === null;
    const checked = check && item.checked === true;
    const classes = [
      THEME.listItem,
      nestedOnly && THEME.nestedListItem,
      check && !nestedOnly && (checked ? THEME.listItemChecked : THEME.listItemUnchecked),
    ];
    // `value` keeps ordered numbering right when nested wrapper <li>s sit between items
    const value = list.listType === "number" && index !== null ? ` value="${index}"` : "";
    let inner = "";
    let run: ContentNode[] = [];
    const flush = () => {
      if (run.length) inner += this.inline(run);
      run = [];
    };
    for (const k of kids) {
      if (typeOf(k) === "list") {
        flush();
        inner += this.list(k as ListNode);
      } else run.push(k);
    }
    flush();
    let prefix = "";
    if (check && !nestedOnly) {
      if (this.web) prefix = `<span class="${BCF_CLASS.srOnly}">${checked ? "Completed: " : "Not completed: "}</span>`;
      else prefix = checked ? "&#9745; " : "&#9744; ";
    }
    const style = this.style(this.em(check ? (nestedOnly ? EMAIL.liNested : EMAIL.liCheck) : nestedOnly ? EMAIL.liNested : EMAIL.li));
    return `<li${this.cls(...classes)}${value}${style}>${prefix}${inner}</li>`;
  }

  /* ----------------------------- code ----------------------------- */

  private code(node: CodeNode): string {
    const children = kidsOf(node);
    let lines = 1;
    let body = "";
    for (const c of children) {
      const t = typeOf(c);
      if (t === "linebreak") {
        lines += 1;
        body += "<br>";
      } else if (t === "tab") {
        body += "\t";
      } else if (t === "code-highlight" || t === "text") {
        body += this.codeToken(c as CodeHighlightNode);
      }
    }
    const lang = typeof node.language === "string" && /^[A-Za-z0-9_+#.-]{1,32}$/.test(node.language) ? node.language : "";
    const attrs: string[] = [];
    if (this.web) {
      attrs.push(`class="${THEME.code}"`, 'spellcheck="false"', 'tabindex="0"');
      if (lang) attrs.push(`data-language="${escapeAttr(lang)}"`);
      const gutter = Array.from({ length: lines }, (_, i) => i + 1).join("&#10;");
      attrs.push(`data-gutter="${gutter}"`);
    } else if (lang) {
      attrs.push(`data-language="${escapeAttr(lang)}"`);
    }
    if (this.email) attrs.push(`style="${escapeAttr(EMAIL.pre)}"`);
    return `<pre${attrs.length ? " " + attrs.join(" ") : ""}>${body}</pre>`;
  }

  private codeToken(node: CodeHighlightNode): string {
    const text = escapeHtml(typeof node.text === "string" ? node.text : "");
    if (text === "") return "";
    if (this.rss) return text;
    const classes: string[] = [];
    if (this.web && typeof node.highlightType === "string") {
      const c = THEME.codeHighlight[node.highlightType];
      if (c) classes.push(c);
    }
    const { declarations, rejected } = sanitizeStyle(node.style, CODE_STYLE_PROPS);
    for (const r of rejected) this.warn("unsafe-style", `dropped CSS property "${r}" from code token`, "code-highlight", r);
    if (classes.length === 0 && declarations.length === 0) return text;
    const style = declarations.length ? ` style="${escapeAttr(stylePairsToString(declarations))}"` : "";
    return `<span${classes.length ? ` class="${classes.join(" ")}"` : ""}${style}>${text}</span>`;
  }

  /* ----------------------------- tables ----------------------------- */

  private table(node: TableNode): string {
    const rows = kidsOf(node).filter((r) => typeOf(r) === "tablerow") as TableRowNode[];
    if (rows.length === 0) return "";
    // all-or-nothing: dropping a single bad entry would shift every later column
    const widths = Array.isArray(node.colWidths) ? node.colWidths.map((w) => safePx(w)) : [];
    const colWidths = widths.length > 0 && widths.every((w): w is number => w !== null) ? (widths as number[]) : [];
    let colgroup = "";
    if (this.web && colWidths.length > 0) {
      colgroup = `<colgroup>${colWidths.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>`;
    }
    const classes: string[] = [THEME.table];
    if (node.rowStriping) classes.push(THEME.tableRowStriping);
    const fmt = typeof node.format === "string" ? node.format : "";
    if (fmt === "center") classes.push(THEME.tableAlignmentCenter);
    else if (fmt === "right") classes.push(THEME.tableAlignmentRight);

    let body = "";
    rows.forEach((row, rowIndex) => {
      const h = safePx(row.height, 2000);
      const cells = kidsOf(row).filter((c) => typeOf(c) === "tablecell") as TableCellNode[];
      let tr = "";
      for (const cell of cells) tr += this.tableCell(cell, rowIndex, node.rowStriping === true);
      body += `<tr${this.style(h !== null && `height:${h}px`)}>${tr}</tr>`;
    });
    const table = `<table${this.cls(...classes)}${this.style(this.em(EMAIL.table))}>${colgroup}<tbody>${body}</tbody></table>`;
    return this.web
      ? `<div class="${THEME.tableScrollableWrapper}" tabindex="0">${table}</div>`
      : table;
  }

  private tableCell(cell: TableCellNode, _rowIndex: number, _striping: boolean): string {
    const header = typeof cell.headerState === "number" && cell.headerState !== 0;
    const tag = header ? "th" : "td";
    const attrs: string[] = [];
    if (header) {
      // headerState bit 1 = header ROW cell (labels a column), bit 2 = header COLUMN cell (labels a row)
      attrs.push(`scope="${cell.headerState === 2 ? "row" : "col"}"`);
    }
    if (typeof cell.colSpan === "number" && cell.colSpan > 1) attrs.push(`colspan="${Math.min(cell.colSpan, 1000)}"`);
    if (typeof cell.rowSpan === "number" && cell.rowSpan > 1) attrs.push(`rowspan="${Math.min(cell.rowSpan, 1000)}"`);
    const styles: Array<string | false> = [];
    if (this.email) styles.push(header ? EMAIL.th : EMAIL.td);
    const w = safePx(cell.width);
    if (w !== null) styles.push(`width:${w}px`);
    if (typeof cell.backgroundColor === "string" && cell.backgroundColor.trim() !== "") {
      if (isSafeColor(cell.backgroundColor) && !/[;{}<>]/.test(cell.backgroundColor)) {
        styles.push(`background-color:${cell.backgroundColor.trim()}`);
      } else {
        this.warn("unsafe-style", "dropped invalid table cell background color", "tablecell", "bg");
      }
    }
    if (cell.verticalAlign === "middle" || cell.verticalAlign === "bottom") styles.push(`vertical-align:${cell.verticalAlign}`);
    const cls = this.cls(THEME.tableCell, header && THEME.tableCellHeader);
    this.cellDepth += 1;
    let inner: string;
    try {
      inner = this.blocks(kidsOf(cell));
    } finally {
      this.cellDepth -= 1;
    }
    return `<${tag}${cls}${attrs.length ? " " + attrs.join(" ") : ""}${this.style(...styles)}>${inner === "" ? "<br>" : inner}</${tag}>`;
  }

  /* ----------------------------- layout / collapsible ----------------------------- */

  private layout(node: LayoutContainerNode): string {
    const items = kidsOf(node).filter((c) => typeOf(c) === "layout-item");
    if (items.length === 0) return "";
    const grid = safeGridTemplateColumns(node.templateColumns) ?? `repeat(${items.length}, 1fr)`;
    if (this.web) {
      const inner = items
        .map((it) => `<div class="${THEME.layoutItem}" data-lexical-layout-item="true">${this.blocks(kidsOf(it))}</div>`)
        .join("");
      return `<div class="${THEME.layoutContainer}" style="grid-template-columns:${escapeAttr(grid)}" data-lexical-layout-container="true">${inner}</div>`;
    }
    if (this.rss) {
      return items.map((it) => `<div>${this.blocks(kidsOf(it))}</div>`).join("");
    }
    // email: table columns
    const widths = columnPercents(grid, items.length);
    const cells = items
      .map(
        (it, i) =>
          `<td valign="top" width="${widths[i]}%" style="${EMAIL.layoutCell}width:${widths[i]}%">${this.blocks(kidsOf(it))}</td>`,
      )
      .join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${EMAIL.layoutTable}"><tr>${cells}</tr></table>`;
  }

  private collapsible(node: CollapsibleContainerNode): string {
    const kids = kidsOf(node);
    const title = kids.find((k) => typeOf(k) === "collapsible-title");
    const contents = kids.filter((k) => typeOf(k) === "collapsible-content");
    const others = kids.filter((k) => typeOf(k) !== "collapsible-title" && typeOf(k) !== "collapsible-content");
    const titleHtml = title ? this.inline(kidsOf(title)) : "";
    const bodyHtml = contents.map((c) => this.blocks(kidsOf(c))).join("") + (others.length ? this.blocks(others) : "");
    if (this.web) {
      return (
        `<details class="${THEME.collapsible.container}"${node.open === false ? "" : " open"}>` +
        `<summary class="${THEME.collapsible.title}">${titleHtml || "Details"}</summary>` +
        `<div class="${THEME.collapsible.content}" data-lexical-collapsible-content="true">${bodyHtml}</div></details>`
      );
    }
    // email / rss: details/summary are not reliably supported; show everything.
    const head = this.email
      ? `<p style="${EMAIL.collapsibleTitle}">${titleHtml || "Details"}</p>`
      : `<p><strong>${titleHtml || "Details"}</strong></p>`;
    return this.email
      ? `<div style="${EMAIL.collapsible}">${head}${bodyHtml}</div>`
      : `<div>${head}${bodyHtml}</div>`;
  }

  /* ----------------------------- media & embeds ----------------------------- */

  private imageHasFigure(img: ImageNode): boolean {
    if (!img.showCaption || !img.caption) return false;
    return img.caption.editorState.root.children.some((c) => this.hasText(c));
  }

  private hasText(node: ContentNode): boolean {
    const n = node as N;
    if (typeof n.text === "string" && (n.text as string).trim() !== "") return true;
    return kidsOf(node).some((c) => this.hasText(c));
  }

  private image(img: ImageNode): string {
    const safe = this.url(img.src, { image: true });
    const alt = typeof img.altText === "string" ? img.altText : "";
    if (!safe) {
      this.warn("unsafe-url", "image source is not allowed; image skipped", "image", String(img.src).slice(0, 80));
      return alt ? `<span>${escapeText(alt)}</span>` : "";
    }
    const attrs: string[] = [`src="${escapeAttr(safe.href)}"`, `alt="${escapeAttr(alt)}"`];
    if (img.width > 0 && Number.isFinite(img.width)) attrs.push(`width="${Math.round(img.width)}"`);
    if (img.height > 0 && Number.isFinite(img.height)) attrs.push(`height="${Math.round(img.height)}"`);
    if (this.web) attrs.push('loading="lazy"', 'decoding="async"');
    attrs.push(`style="${this.email ? EMAIL.img : "max-width:100%;height:auto"}"`);
    if (this.web) attrs.push(`class="${BCF_CLASS.image}"`);
    const imgTag = `<img ${attrs.join(" ")}>`;
    if (!this.imageHasFigure(img)) return imgTag;

    const rootKids = img.caption!.editorState.root.children;
    const paragraphs = rootKids.filter((c) => typeOf(c) === "paragraph");
    const caption =
      rootKids.length === 1 && paragraphs.length === 1 ? this.inline(kidsOf(paragraphs[0]!)) : this.blocks(rootKids);
    if (this.email) {
      return `<div style="${EMAIL.figure}">${imgTag}<div style="${EMAIL.figcaption}">${caption}</div></div>`;
    }
    return `<figure${this.cls(BCF_CLASS.figure)}>${imgTag}<figcaption>${caption}</figcaption></figure>`;
  }

  private equation(node: EquationNode): string {
    const eq = node.equation;
    const display = !node.inline;
    if (this.web) {
      const html = renderKatex(eq, display);
      if (html) {
        return display
          ? `<div class="${BCF_CLASS.equation} ${BCF_CLASS.equationBlock}">${html}</div>`
          : `<span class="${BCF_CLASS.equation}">${html}</span>`;
      }
    }
    // email / rss (and KaTeX failure): LaTeX source as code
    const code = `<code${this.style(this.em(EMAIL.code))}>${escapeHtml(eq)}</code>`;
    return display ? `<p${this.style(this.em(EMAIL.p))}${this.web ? ` class="${THEME.paragraph}"` : ""}>${code}</p>` : code;
  }

  private embedAlign(node: { format?: unknown }): string {
    const f = typeof node.format === "string" ? node.format : "";
    return f === "center" || f === "right" || f === "justify" || f === "end" || f === "left" || f === "start"
      ? `text-align:${f === "justify" ? "left" : f}`
      : "";
  }

  private iframe(opts: {
    src: string;
    title: string;
    kind: string;
    width: number;
    height: number;
    ratio?: string;
    allow?: string;
    node: { format?: unknown };
  }): string {
    if (!isAllowedEmbedUrl(opts.src)) {
      this.warn("blocked-embed", "embed host is not on the allowlist", opts.kind, opts.src);
      return "";
    }
    const sizing = opts.ratio
      ? `width:100%;max-width:${opts.width}px;aspect-ratio:${opts.ratio};height:auto;border:0`
      : `width:100%;max-width:${opts.width}px;height:${opts.height}px;border:0`;
    const align = this.embedAlign(opts.node);
    return (
      `<div class="${BCF_CLASS.embed} ${opts.kind}"${align ? ` style="${align}"` : ""}>` +
      `<iframe src="${escapeAttr(opts.src)}" title="${escapeAttr(opts.title)}" width="${opts.width}" height="${opts.height}" ` +
      `loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen ` +
      (opts.allow ? `allow="${escapeAttr(opts.allow)}" ` : "") +
      `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" ` +
      `style="${sizing}"></iframe></div>`
    );
  }

  private embedLink(href: string, label: string, opts: { thumb?: string; alt?: string } = {}): string {
    const body = opts.thumb
      ? `<img src="${escapeAttr(opts.thumb)}" alt="${escapeAttr(opts.alt ?? label)}" width="560" style="${EMAIL.img}"><br>${escapeHtml(label)}`
      : escapeHtml(label);
    const rel = this.web || this.rss ? ' rel="noopener noreferrer nofollow"' : "";
    const target = this.web ? ' target="_blank"' : "";
    const a = `<a href="${escapeAttr(href)}"${target}${rel}${this.cls(THEME.link)}${this.style(this.em(EMAIL.link))}>${body}</a>`;
    return `<p${this.cls(THEME.paragraph)}${this.style(this.em(EMAIL.p))}>${a}</p>`;
  }

  private youtube(node: YouTubeNode): string {
    const id = node.videoID;
    if (this.web && this.opts.embeds !== "link") {
      return this.iframe({
        src: youtubeEmbedUrl(id),
        title: "YouTube video player",
        kind: BCF_CLASS.embedYoutube,
        width: 560,
        height: 315,
        ratio: "16/9",
        allow: "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        node,
      });
    }
    return this.embedLink(youtubeWatchUrl(id), "Watch on YouTube", this.email ? { thumb: youtubeThumbnailUrl(id), alt: "Watch on YouTube" } : {});
  }

  private figma(node: FigmaNode): string {
    const id = node.documentID;
    if (this.web && this.opts.embeds !== "link") {
      return this.iframe({
        src: figmaEmbedUrl(id),
        title: "Figma embed",
        kind: BCF_CLASS.embedFigma,
        width: 560,
        height: 315,
        ratio: "16/9",
        node,
      });
    }
    return this.embedLink(figmaFileUrl(id), "View the Figma file");
  }

  private tweet(node: TweetNode): string {
    const id = node.id;
    if (this.web && this.opts.embeds !== "link") {
      return this.iframe({
        src: tweetEmbedUrl(id),
        title: "Embedded post on X",
        kind: BCF_CLASS.embedTweet,
        width: 550,
        height: 500,
        node,
      });
    }
    return this.embedLink(tweetUrl(id), "View post on X");
  }

  /* ----------------------------- inline ----------------------------- */

  inline(nodes: ContentNode[]): string {
    let out = "";
    for (const node of nodes) out += this.inlineNode(node);
    return out;
  }

  private inlineNode(node: ContentNode): string {
    const t = typeOf(node);
    const n = node as N;
    switch (t) {
      case "text":
        return this.text(n.text as string, (n.format as number) ?? 0, n.style);
      case "linebreak":
        return "<br>";
      case "tab":
        return this.web ? `<span class="${THEME.tab}" style="white-space:pre">\t</span>` : "&emsp;";
      case "hashtag":
        return this.textLike(n, this.web ? `<span class="${THEME.hashtag}">` : "", this.web ? "</span>" : "");
      case "keyword":
        return this.textLike(n, this.web ? `<span class="${BCF_CLASS.keyword}">` : "", this.web ? "</span>" : "");
      case "specialText":
        return this.textLike(n, this.web ? `<span class="${THEME.specialText}">` : "", this.web ? "</span>" : "");
      case "mention":
        return this.textLike(
          n,
          this.web ? `<span class="${BCF_CLASS.mention}" data-mention="${escapeAttr(String(n.mentionName ?? ""))}">` : "",
          this.web ? "</span>" : "",
        );
      case "emoji":
        return this.textLike(n, this.web ? `<span class="${BCF_CLASS.emoji}">` : "", this.web ? "</span>" : "");
      case "code-highlight":
        return this.text(n.text as string, 0, n.style);
      case "link":
      case "autolink":
        return this.link(node as LinkNode);
      case "mark":
      case "overflow":
        return this.inline(kidsOf(node));
      case "image":
        return this.image(node as ImageNode);
      case "equation":
        return this.equation(node as EquationNode);
      case "datetime":
        return this.datetime(node as DateTimeNode);
      default:
        // block node in inline context: render it as a block (browsers will cope) or skip unknown
        if (BLOCK_TYPES.has(t)) return this.block(node);
        return this.unknown(node);
    }
  }

  private textLike(n: N, open: string, close: string): string {
    const text = typeof n.text === "string" ? (n.text as string) : "";
    if (text === "") return "";
    const fmt = typeof n.format === "number" ? n.format : 0;
    const inner = fmt || n.style ? this.text(text, fmt, n.style) : escapeText(text);
    return `${open}${inner}${close}`;
  }

  private datetime(node: DateTimeNode): string {
    const iso = toIsoString(node.dateTime);
    if (!iso) {
      this.warn("invalid-date", "skipped date-time with an unparseable value", "datetime");
      return "";
    }
    const label = escapeHtml(formatDateTime(node.dateTime));
    return `<time${this.cls(BCF_CLASS.datetime)} datetime="${escapeAttr(iso)}">${label}</time>`;
  }

  private link(node: LinkNode): string {
    const inner = this.inline(kidsOf(node));
    if ((node as { isUnlinked?: boolean }).isUnlinked === true) return inner;
    const safe = this.url(node.url);
    if (!safe) {
      this.warn("unsafe-url", "link URL is not allowed; rendered as plain text", typeOf(node), String(node.url).slice(0, 80));
      return inner;
    }
    if (inner.trim() === "") return "";
    const attrs: string[] = [`href="${escapeAttr(safe.href)}"`];
    if (typeof node.title === "string" && node.title !== "") attrs.push(`title="${escapeAttr(node.title.slice(0, 500))}"`);
    if (safe.external && (safe.kind === "absolute")) {
      if (this.web) attrs.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
      else if (this.rss) attrs.push('rel="noopener noreferrer nofollow"');
    }
    const classes = this.cls(THEME.link);
    return `<a ${attrs.join(" ")}${classes}${this.style(this.em(EMAIL.link))}>${inner}</a>`;
  }

  /** Text with format bits and sanitised style. */
  private text(raw: string, formatBits: number, styleStr: unknown): string {
    const text = typeof raw === "string" ? raw : "";
    if (text === "") return "";
    const fmt = (Number.isFinite(formatBits) ? Math.trunc(formatBits) : 0) & TEXT_FORMAT_MASK;
    const { declarations, rejected } = this.rss ? { declarations: [], rejected: [] as string[] } : sanitizeStyle(styleStr);
    for (const r of rejected) this.warn("unsafe-style", `dropped CSS property "${r}" from text style`, "text", r);
    if (fmt === 0 && declarations.length === 0) return escapeText(text);

    const has = (bit: number) => (fmt & bit) !== 0;
    const bold = has(TEXT_FORMAT.bold);
    const italic = has(TEXT_FORMAT.italic);
    const strike = has(TEXT_FORMAT.strikethrough);
    const underline = has(TEXT_FORMAT.underline);
    const code = has(TEXT_FORMAT.code);
    const sub = has(TEXT_FORMAT.subscript);
    const sup = has(TEXT_FORMAT.superscript);
    const highlight = has(TEXT_FORMAT.highlight);

    // classes of the editor theme (web)
    const classes: string[] = [];
    if (this.web) {
      if (bold) classes.push(THEME.text.bold);
      if (italic) classes.push(THEME.text.italic);
      if (strike && underline) classes.push(THEME.text.underlineStrikethrough);
      else if (underline) classes.push(THEME.text.underline);
      else if (strike) classes.push(THEME.text.strikethrough);
      if (code) classes.push(THEME.text.code);
      if (highlight) classes.push(THEME.text.highlight);
      if (sub) classes.push(THEME.text.subscript);
      if (sup) classes.push(THEME.text.superscript);
      if (has(TEXT_FORMAT.lowercase)) classes.push(THEME.text.lowercase);
      if (has(TEXT_FORMAT.uppercase)) classes.push(THEME.text.uppercase);
      if (has(TEXT_FORMAT.capitalize)) classes.push(THEME.text.capitalize);
    }

    // semantic wrappers, outermost first (stable order)
    const tags: Array<{ tag: string; style?: string }> = [];
    if (highlight) tags.push({ tag: "mark", style: this.email ? EMAIL.mark : undefined });
    if (sup) tags.push({ tag: "sup" });
    if (sub) tags.push({ tag: "sub" });
    if (strike) tags.push({ tag: "s" });
    if (underline) tags.push({ tag: "u" });
    if (italic) tags.push({ tag: "em" });
    if (bold) tags.push({ tag: "strong" });
    if (code) tags.push({ tag: "code", style: this.email ? EMAIL.code : undefined });
    const emailExtra: string[] = [];
    if (this.email) {
      if (has(TEXT_FORMAT.lowercase)) emailExtra.push("text-transform:lowercase");
      if (has(TEXT_FORMAT.uppercase)) emailExtra.push("text-transform:uppercase");
      if (has(TEXT_FORMAT.capitalize)) emailExtra.push("text-transform:capitalize");
    }
    const userStyle = stylePairsToString(declarations);

    const inner = escapeText(text);
    if (tags.length === 0) {
      const styleParts = [userStyle, ...emailExtra].filter(Boolean).join(";");
      const attrs = `${classes.length ? ` class="${classes.join(" ")}"` : ""}${styleParts ? ` style="${escapeAttr(styleParts)}"` : ""}`;
      return `<span${attrs}>${inner}</span>`;
    }
    // class + user style live on the innermost element
    let html = inner;
    for (let i = tags.length - 1; i >= 0; i--) {
      const t = tags[i]!;
      const innermost = i === tags.length - 1;
      const styleParts = [t.style, innermost ? userStyle : "", innermost ? emailExtra.join(";") : ""].filter(Boolean).join(";");
      const attrs = `${innermost && classes.length ? ` class="${classes.join(" ")}"` : ""}${styleParts ? ` style="${escapeAttr(styleParts)}"` : ""}`;
      html = `<${t.tag}${attrs}>${html}</${t.tag}>`;
    }
    return html;
  }
}

/** Percent widths for email layout columns (from `fr` ratios, else equal). */
function columnPercents(grid: string, count: number): number[] {
  const frs = [...grid.matchAll(/(\d+(?:\.\d+)?)fr\b/g)].map((m) => Number(m[1]));
  const usable = !/repeat|minmax/i.test(grid) && frs.length === count && frs.every((n) => n > 0);
  const weights = usable ? frs : Array.from({ length: count }, () => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / total) * 1000) / 10);
}

/* ------------------------------------------------------------------ */

function resolveDoc(content: ContentInput, collect: (w: ContentIssue) => void): Content {
  if (isParsedContent(content)) return content;
  const parsed = parseContent(content);
  for (const w of parsed.warnings) collect(w);
  return parsed.content;
}

/**
 * Render a document and also return the warnings (unknown nodes skipped, unsafe URLs/styles dropped…).
 * Never throws: a failure inside a block yields an empty string for that block and a `render-error` warning.
 */
export function renderContent(content: ContentInput, options: RenderOptions = {}): RenderResult {
  const target: RenderTarget = options.target === "email" || options.target === "rss" ? options.target : "web";
  const warnings: ContentIssue[] = [];
  const collect = (w: ContentIssue) => {
    warnings.push(w);
    options.onWarning?.(w);
  };
  try {
    const doc = resolveDoc(content, collect);
    const renderer = new Renderer(doc, options, target);
    if (target !== "web" && !options.baseUrl) {
      renderer.warn("unsafe-url", `${target} target without baseUrl: relative URLs stay relative`, undefined, "no-base");
    }
    let html = "";
    try {
      html = renderer.renderRoot();
    } catch (e) {
      renderer.warn("render-error", `renderer failure: ${(e as Error).message}`);
    }
    warnings.push(...renderer.warnings);
    return { html, warnings };
  } catch (e) {
    collect({ code: "render-error", message: `renderer failure: ${(e as Error).message}`, path: "render" });
    return { html: "", warnings };
  }
}

/** Render to an HTML fragment string. See {@link RenderOptions}. */
export function renderHtml(content: ContentInput, options: RenderOptions = {}): string {
  return renderContent(content, options).html;
}

export { absolutize };
