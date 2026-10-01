/**
 * TypeScript types for Blog Content Format (BCF) v1 — Lexical 0.40 `SerializedEditorState`
 * as produced by @scottjgilbert/lexical-blog-editor. See STANDARD.md for the normative description.
 *
 * Every node keeps unknown extra properties (`[key: string]: unknown`) so that parse → serialize
 * round-trips without losing data written by newer editors.
 */

export type ElementFormat = "" | "left" | "start" | "center" | "right" | "end" | "justify";
export type Direction = "ltr" | "rtl" | null;

export interface BaseNode {
  type: string;
  version: number;
  [key: string]: unknown;
}

export interface ElementBase extends BaseNode {
  children: ContentNode[];
  direction?: Direction;
  format?: ElementFormat | number;
  indent?: number;
}

/* ----- core ----- */
export interface RootNode extends ElementBase {
  type: "root";
}
export interface ParagraphNode extends ElementBase {
  type: "paragraph";
  textFormat?: number;
  textStyle?: string;
}
export interface TextNode extends BaseNode {
  type: "text";
  text: string;
  /** bitmask, see TEXT_FORMAT */
  format: number;
  /** inline CSS declarations, allowlisted at render time */
  style: string;
  mode?: "normal" | "token" | "segmented";
  detail?: number;
}
export interface LineBreakNode extends BaseNode {
  type: "linebreak";
}
export interface TabNode extends BaseNode {
  type: "tab";
  text: string;
  format?: number;
  style?: string;
}

/* ----- @lexical/* ----- */
export interface HeadingNode extends ElementBase {
  type: "heading";
  tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}
export interface QuoteNode extends ElementBase {
  type: "quote";
}
export interface ListNode extends ElementBase {
  type: "list";
  listType: "bullet" | "number" | "check";
  start: number;
  tag: "ul" | "ol";
}
export interface ListItemNode extends ElementBase {
  type: "listitem";
  value: number;
  /** only meaningful in `check` lists */
  checked?: boolean;
}
export interface LinkNode extends ElementBase {
  type: "link";
  url: string;
  rel?: string | null;
  target?: string | null;
  title?: string | null;
}
export interface AutoLinkNode extends ElementBase {
  type: "autolink";
  url: string;
  rel?: string | null;
  target?: string | null;
  title?: string | null;
  isUnlinked?: boolean;
}
export interface CodeNode extends ElementBase {
  type: "code";
  language?: string | null;
  theme?: string | null;
}
export interface CodeHighlightNode extends BaseNode {
  type: "code-highlight";
  text: string;
  format?: number;
  style?: string;
  highlightType?: string | null;
}
export interface HorizontalRuleNode extends BaseNode {
  type: "horizontalrule";
}
export interface TableNode extends ElementBase {
  type: "table";
  colWidths?: number[];
  rowStriping?: boolean;
  frozenColumnCount?: number;
  frozenRowCount?: number;
}
export interface TableRowNode extends ElementBase {
  type: "tablerow";
  height?: number | null;
}
export interface TableCellNode extends ElementBase {
  type: "tablecell";
  /** bitmask, see TABLE_HEADER (1 = header row cell, 2 = header column cell) */
  headerState: number;
  colSpan: number;
  rowSpan: number;
  width?: number | null;
  backgroundColor?: string | null;
  verticalAlign?: "top" | "middle" | "bottom" | null;
}
export interface HashtagNode extends BaseNode {
  type: "hashtag";
  text: string;
  format?: number;
  style?: string;
}
export interface MarkNode extends ElementBase {
  type: "mark";
  ids?: string[];
}
export interface OverflowNode extends ElementBase {
  type: "overflow";
}

/* ----- editor package custom nodes ----- */
export interface SerializedCaption {
  editorState: { root: RootNode };
}
export interface ImageNode extends BaseNode {
  type: "image";
  src: string;
  altText: string;
  /** 0 means "inherit" (natural size) */
  width: number;
  height: number;
  maxWidth: number;
  showCaption: boolean;
  caption?: SerializedCaption;
}
export interface EquationNode extends BaseNode {
  type: "equation";
  equation: string;
  inline: boolean;
}
export interface EmojiNode extends BaseNode {
  type: "emoji";
  text: string;
  className: string;
  format?: number;
  style?: string;
}
export interface MentionNode extends BaseNode {
  type: "mention";
  text: string;
  mentionName: string;
  format?: number;
  style?: string;
}
export interface KeywordNode extends BaseNode {
  type: "keyword";
  text: string;
  format?: number;
  style?: string;
}
export interface SpecialTextNode extends BaseNode {
  type: "specialText";
  text: string;
  format?: number;
  style?: string;
}
export interface YouTubeNode extends BaseNode {
  type: "youtube";
  videoID: string;
  format?: ElementFormat | number;
}
export interface TweetNode extends BaseNode {
  type: "tweet";
  id: string;
  format?: ElementFormat | number;
}
export interface FigmaNode extends BaseNode {
  type: "figma";
  documentID: string;
  format?: ElementFormat | number;
}
export interface LayoutContainerNode extends ElementBase {
  type: "layout-container";
  templateColumns: string;
}
export interface LayoutItemNode extends ElementBase {
  type: "layout-item";
}
export interface CollapsibleContainerNode extends ElementBase {
  type: "collapsible-container";
  open: boolean;
}
export interface CollapsibleTitleNode extends ElementBase {
  type: "collapsible-title";
}
export interface CollapsibleContentNode extends ElementBase {
  type: "collapsible-content";
}
export interface DateTimeNode extends BaseNode {
  type: "datetime";
  /** ISO-8601 instant (`Date#toISOString()`) */
  dateTime: string;
}

/* ----- BCF extension ----- */
export interface PageBreakNode extends BaseNode {
  type: "page-break";
}

export type KnownNode =
  | RootNode
  | ParagraphNode
  | TextNode
  | LineBreakNode
  | TabNode
  | HeadingNode
  | QuoteNode
  | ListNode
  | ListItemNode
  | LinkNode
  | AutoLinkNode
  | CodeNode
  | CodeHighlightNode
  | HorizontalRuleNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | HashtagNode
  | MarkNode
  | OverflowNode
  | ImageNode
  | EquationNode
  | EmojiNode
  | MentionNode
  | KeywordNode
  | SpecialTextNode
  | YouTubeNode
  | TweetNode
  | FigmaNode
  | LayoutContainerNode
  | LayoutItemNode
  | CollapsibleContainerNode
  | CollapsibleTitleNode
  | CollapsibleContentNode
  | DateTimeNode
  | PageBreakNode;

/** A node whose `type` BCF v1 does not know. Preserved verbatim; skipped when rendering. */
export interface UnknownNode extends BaseNode {
  children?: ContentNode[];
}

export type ContentNode = KnownNode | UnknownNode;

/** A BCF document: the object stored in `post.content`. */
export interface Content {
  root: RootNode;
}

/** Anything accepted by the library entry points: a parsed {@link Content}, raw JSON, or a JSON string. */
export type ContentInput = Content | unknown;

export type WarningCode =
  | "invalid-json"
  | "invalid-root"
  | "invalid-node"
  | "invalid-attribute"
  | "unknown-node-type"
  | "newer-node-version"
  | "misplaced-node"
  | "max-depth"
  | "max-nodes"
  | "max-bytes"
  | "string-too-long"
  | "non-finite-number"
  | "non-json-value"
  | "forbidden-key"
  | "unsafe-url"
  | "unsafe-style"
  | "blocked-embed"
  | "invalid-date"
  | "render-error";

export interface ContentIssue {
  code: WarningCode;
  message: string;
  /** JSON-pointer-like path, e.g. `root.children[3].children[0]` */
  path: string;
  /** node `type` the issue relates to, when known */
  nodeType?: string;
}

export interface ParseStats {
  nodes: number;
  maxDepth: number;
  unknownTypes: string[];
}

export interface ParseResult {
  /** Always a structurally sound document (an empty one when the input was unusable). */
  content: Content;
  /** Problems found and repaired (nodes dropped, attributes defaulted, unknown types kept). */
  warnings: ContentIssue[];
  /** false when the input was not a usable document (root missing / malformed / limits hit) */
  valid: boolean;
  stats: ParseStats;
}

export interface ValidationResult {
  ok: boolean;
  /** Blocking problems. Content with errors must not be stored. */
  errors: ContentIssue[];
  /** Non-blocking: unknown node types, misplaced nodes. Such content may be stored. */
  warnings: ContentIssue[];
  stats: ParseStats;
}

export type RenderTarget = "web" | "email" | "rss";

export interface RenderOptions {
  /** `web` (default): classes of the editor viewer theme + interactive elements.
   *  `email`: inline styles only, table-safe, no scripts/iframes/details.
   *  `rss`: semantic HTML, absolute URLs, no scripts/iframes/classes. */
  target?: RenderTarget;
  /** Site origin (e.g. `https://blog.example.com`). Required to make relative URLs absolute for email/rss,
   *  and used to tell internal from external links. */
  baseUrl?: string;
  /** How to render YouTube/Figma/Tweet nodes on `web`: allowlisted iframes (default) or plain links. */
  embeds?: "iframe" | "link";
  /** `skip` (default): drop unknown nodes (with a warning). `unwrap`: render their children / text. */
  unknown?: "skip" | "unwrap";
  /** Prefix for heading ids (must match `extractToc`'s `idPrefix`). */
  headingIdPrefix?: string;
  /** Called for every issue found while rendering. */
  onWarning?: (issue: ContentIssue) => void;
}

export interface RenderResult {
  html: string;
  warnings: ContentIssue[];
}

export interface TocEntry {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
}
