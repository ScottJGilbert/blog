/**
 * Constants shared by the parser, validator and renderers.
 * Normative values live in STANDARD.md; keep both in sync.
 */

/** Lexical TextNode `format` bitmask (Lexical 0.40). */
export const TEXT_FORMAT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  subscript: 32,
  superscript: 64,
  highlight: 128,
  lowercase: 256,
  uppercase: 512,
  capitalize: 1024,
} as const;

/** All bits BCF v1 defines for `text.format`. Unknown higher bits are ignored. */
export const TEXT_FORMAT_MASK = 2047;

/** TableCellNode `headerState` bitmask. */
export const TABLE_HEADER = { none: 0, row: 1, column: 2, both: 3 } as const;

/** Node types produced by Lexical core. */
export const CORE_NODE_TYPES = ["root", "paragraph", "text", "linebreak", "tab"] as const;

/** Node types produced by the @lexical/* packages enabled in the editor. */
export const LEXICAL_PACKAGE_NODE_TYPES = [
  "heading",
  "quote",
  "list",
  "listitem",
  "link",
  "autolink",
  "code",
  "code-highlight",
  "horizontalrule",
  "table",
  "tablerow",
  "tablecell",
  "hashtag",
  "mark",
  "overflow",
] as const;

/** Custom nodes defined by @scottjgilbert/lexical-blog-editor. */
export const EDITOR_CUSTOM_NODE_TYPES = [
  "image",
  "equation",
  "emoji",
  "mention",
  "keyword",
  "specialText",
  "youtube",
  "tweet",
  "figma",
  "layout-container",
  "layout-item",
  "collapsible-container",
  "collapsible-title",
  "collapsible-content",
  "datetime",
] as const;

/** BCF extension types: supported by the renderer, NOT emitted by the current editor package. */
export const EXTENSION_NODE_TYPES = ["page-break"] as const;

/** Every node `type` BCF v1 understands. Anything else is an "unknown node". */
export const SUPPORTED_NODE_TYPES = [
  ...CORE_NODE_TYPES,
  ...LEXICAL_PACKAGE_NODE_TYPES,
  ...EDITOR_CUSTOM_NODE_TYPES,
  ...EXTENSION_NODE_TYPES,
] as const;

export type SupportedNodeType = (typeof SUPPORTED_NODE_TYPES)[number];

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_NODE_TYPES);
export function isSupportedNodeType(type: string): type is SupportedNodeType {
  return SUPPORTED_SET.has(type);
}

/** Structural limits (STANDARD.md §Limits). */
export const CONTENT_LIMITS = {
  /** Max element nesting depth below root (root = 0). */
  maxDepth: 64,
  /** Max number of nodes (including nested image caption nodes). */
  maxNodes: 50_000,
  /** Max serialized size (JSON.stringify length). The API may enforce a lower request limit. */
  maxBytes: 2 * 1024 * 1024,
  /** Max length of one text node. */
  maxTextLength: 100_000,
  /** Max length of a URL attribute (http(s)/relative). */
  maxUrlLength: 4096,
  /** Max length of an inline `data:image/*` image source. */
  maxDataUriLength: 2 * 1024 * 1024,
  /** Max LaTeX source length. */
  maxEquationLength: 10_000,
  /** Max raw JSON nesting accepted by the pre-scan (guards cyclic / hostile input). */
  maxJsonDepth: 400,
} as const;

/** URL schemes allowed for links. Images additionally allow inline raster `data:` URIs. */
export const ALLOWED_LINK_SCHEMES = ["http", "https", "mailto", "tel"] as const;

/** Hosts an `<iframe>` may point at. Embed URLs are always built by us from validated ids. */
export const EMBED_HOSTS = {
  youtube: ["www.youtube-nocookie.com", "www.youtube.com"],
  figma: ["www.figma.com"],
  twitter: ["platform.twitter.com"],
} as const;

/** Class names of the editor package's viewer theme (`ViewerTheme.css`). */
export const THEME = {
  paragraph: "ViewerTheme__paragraph",
  quote: "ViewerTheme__quote",
  heading: {
    h1: "ViewerTheme__h1",
    h2: "ViewerTheme__h2",
    h3: "ViewerTheme__h3",
    h4: "ViewerTheme__h4",
    h5: "ViewerTheme__h5",
    h6: "ViewerTheme__h6",
  },
  text: {
    bold: "ViewerTheme__textBold",
    italic: "ViewerTheme__textItalic",
    underline: "ViewerTheme__textUnderline",
    strikethrough: "ViewerTheme__textStrikethrough",
    underlineStrikethrough: "ViewerTheme__textUnderlineStrikethrough",
    code: "ViewerTheme__textCode",
    highlight: "ViewerTheme__textHighlight",
    subscript: "ViewerTheme__textSubscript",
    superscript: "ViewerTheme__textSuperscript",
    lowercase: "ViewerTheme__textLowercase",
    uppercase: "ViewerTheme__textUppercase",
    capitalize: "ViewerTheme__textCapitalize",
  },
  tab: "ViewerTheme__tabNode",
  link: "ViewerTheme__link",
  hashtag: "ViewerTheme__hashtag",
  specialText: "ViewerTheme__specialText",
  hr: "ViewerTheme__hr",
  code: "ViewerTheme__code",
  ul: "ViewerTheme__ul",
  olDepth: [
    "ViewerTheme__ol1",
    "ViewerTheme__ol2",
    "ViewerTheme__ol3",
    "ViewerTheme__ol4",
    "ViewerTheme__ol5",
  ],
  checklist: "ViewerTheme__checklist",
  listItem: "ViewerTheme__listItem",
  listItemChecked: "ViewerTheme__listItemChecked",
  listItemUnchecked: "ViewerTheme__listItemUnchecked",
  nestedListItem: "ViewerTheme__nestedListItem",
  table: "ViewerTheme__table",
  tableScrollableWrapper: "ViewerTheme__tableScrollableWrapper",
  tableCell: "ViewerTheme__tableCell",
  tableCellHeader: "ViewerTheme__tableCellHeader",
  tableRowStriping: "ViewerTheme__tableRowStriping",
  tableAlignmentCenter: "ViewerTheme__tableAlignmentCenter",
  tableAlignmentRight: "ViewerTheme__tableAlignmentRight",
  layoutContainer: "ViewerTheme__layoutContainer",
  layoutItem: "ViewerTheme__layoutItem",
  /** Highlight token classes for `code-highlight.highlightType`. */
  codeHighlight: {
    atrule: "ViewerTheme__tokenAttr",
    attr: "ViewerTheme__tokenAttr",
    boolean: "ViewerTheme__tokenProperty",
    builtin: "ViewerTheme__tokenSelector",
    cdata: "ViewerTheme__tokenComment",
    char: "ViewerTheme__tokenSelector",
    class: "ViewerTheme__tokenFunction",
    "class-name": "ViewerTheme__tokenFunction",
    comment: "ViewerTheme__tokenComment",
    constant: "ViewerTheme__tokenProperty",
    deleted: "ViewerTheme__tokenDeleted",
    doctype: "ViewerTheme__tokenComment",
    entity: "ViewerTheme__tokenOperator",
    function: "ViewerTheme__tokenFunction",
    important: "ViewerTheme__tokenVariable",
    inserted: "ViewerTheme__tokenInserted",
    keyword: "ViewerTheme__tokenAttr",
    namespace: "ViewerTheme__tokenVariable",
    number: "ViewerTheme__tokenProperty",
    operator: "ViewerTheme__tokenOperator",
    prolog: "ViewerTheme__tokenComment",
    property: "ViewerTheme__tokenProperty",
    punctuation: "ViewerTheme__tokenPunctuation",
    regex: "ViewerTheme__tokenVariable",
    selector: "ViewerTheme__tokenSelector",
    string: "ViewerTheme__tokenSelector",
    symbol: "ViewerTheme__tokenProperty",
    tag: "ViewerTheme__tokenProperty",
    unchanged: "ViewerTheme__tokenUnchanged",
    url: "ViewerTheme__tokenOperator",
    variable: "ViewerTheme__tokenVariable",
  } as Record<string, string>,
  /** Classes that are not part of ViewerTheme.css but of the editor's own CSS (kept for parity). */
  collapsible: {
    container: "Collapsible__container",
    title: "Collapsible__title",
    content: "Collapsible__content",
  },
} as const;

/** Extra classes provided by `@blog/content/styles.css` (not part of the editor's theme). */
export const BCF_CLASS = {
  content: "bcf-content",
  equation: "bcf-equation",
  equationBlock: "bcf-equation--block",
  embed: "bcf-embed",
  embedYoutube: "bcf-embed--youtube",
  embedFigma: "bcf-embed--figma",
  embedTweet: "bcf-embed--tweet",
  datetime: "bcf-datetime",
  emoji: "bcf-emoji",
  mention: "bcf-mention",
  keyword: "keyword",
  figure: "bcf-figure",
  image: "bcf-image",
  pageBreak: "bcf-page-break",
  srOnly: "bcf-sr-only",
  unknown: "bcf-unknown",
} as const;

/** Pixels per indent level (matches the editor's `--lexical-indent-base-value`). */
export const INDENT_PX = 40;
export const MAX_INDENT = 20;
