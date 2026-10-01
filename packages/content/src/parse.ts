/**
 * Parsing / validation engine.
 *
 * One traversal serves both `parseContent` (tolerant: repair + warn) and `validateContent`
 * (strict: the same problems are reported as errors). The output tree is normalised: known
 * nodes carry typed, defaulted attributes; unknown nodes and unknown properties are preserved verbatim.
 */
import { z } from "zod";
import { CONTENT_LIMITS, isSupportedNodeType, type SupportedNodeType } from "./constants";
import { isDangerousScheme, isValidFigmaId, isValidTweetId, isValidYouTubeId, sanitizeUrl } from "./url";
import type {
  Content,
  ContentIssue,
  ContentNode,
  ParseResult,
  ParseStats,
  RootNode,
  ValidationResult,
  WarningCode,
} from "./types";

/* ------------------------------------------------------------------ */
/* Structure classification (STANDARD.md "Allowed children")           */
/* ------------------------------------------------------------------ */

export const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "root",
  "paragraph",
  "heading",
  "quote",
  "list",
  "listitem",
  "link",
  "autolink",
  "code",
  "table",
  "tablerow",
  "tablecell",
  "mark",
  "overflow",
  "layout-container",
  "layout-item",
  "collapsible-container",
  "collapsible-title",
  "collapsible-content",
]);

export const INLINE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "linebreak",
  "tab",
  "hashtag",
  "keyword",
  "specialText",
  "mention",
  "emoji",
  "code-highlight",
  "link",
  "autolink",
  "mark",
  "overflow",
  "image",
  "datetime",
  "equation",
]);

export const BLOCK_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "quote",
  "list",
  "code",
  "horizontalrule",
  "table",
  "youtube",
  "tweet",
  "figma",
  "equation",
  "layout-container",
  "collapsible-container",
  "page-break",
]);

type ChildPolicy = "inline" | "block" | ReadonlySet<string>;
const CHILD_POLICY: Record<string, ChildPolicy> = {
  root: "block",
  paragraph: "inline",
  heading: "inline",
  quote: "inline",
  link: "inline",
  autolink: "inline",
  mark: "inline",
  overflow: "inline",
  code: new Set(["code-highlight", "text", "tab", "linebreak"]),
  list: new Set(["listitem"]),
  listitem: new Set([...INLINE_TYPES, "list"]),
  table: new Set(["tablerow"]),
  tablerow: new Set(["tablecell"]),
  tablecell: "block",
  "layout-container": new Set(["layout-item"]),
  "layout-item": "block",
  "collapsible-container": new Set(["collapsible-title", "collapsible-content"]),
  "collapsible-title": "inline",
  "collapsible-content": "block",
};

function childAllowed(parent: string, child: string): boolean {
  const policy = CHILD_POLICY[parent];
  if (!policy) return true;
  if (policy === "inline") return INLINE_TYPES.has(child);
  if (policy === "block") return BLOCK_TYPES.has(child) || child === "paragraph";
  return policy.has(child);
}

/* ------------------------------------------------------------------ */
/* Engine context                                                      */
/* ------------------------------------------------------------------ */

interface Ctx {
  strict: boolean;
  errors: ContentIssue[];
  warnings: ContentIssue[];
  nodes: number;
  maxDepth: number;
  unknownTypes: Set<string>;
  reportedOnce: Set<string>;
  stopped: boolean;
  limits: Limits;
}

export interface Limits {
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
}

type Severity = "error" | "warning";

function report(
  ctx: Ctx,
  severity: Severity,
  code: WarningCode,
  message: string,
  path: string,
  nodeType?: string,
): void {
  const issue: ContentIssue = { code, message, path, ...(nodeType ? { nodeType } : {}) };
  if (ctx.strict && severity === "error") ctx.errors.push(issue);
  else ctx.warnings.push(issue);
}

function reportOnce(
  ctx: Ctx,
  key: string,
  severity: Severity,
  code: WarningCode,
  message: string,
  path: string,
  nodeType?: string,
): void {
  if (ctx.reportedOnce.has(key)) return;
  ctx.reportedOnce.add(key);
  report(ctx, severity, code, message, path, nodeType);
}

/* ------------------------------------------------------------------ */
/* Zod attribute schemas                                               */
/* ------------------------------------------------------------------ */

const ELEMENT_FORMATS = ["", "left", "start", "center", "right", "end", "justify"] as const;

function schemasFor(strict: boolean) {
  /** optional attribute: tolerant mode defaults + recovers, strict mode validates. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lenient = <T extends z.ZodType>(schema: T, fallback: z.output<T>): z.ZodType<z.output<T> | undefined> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strict ? schema.optional() : (schema as any).default(fallback).catch(fallback);
  /** optional + nullable attribute whose absence means "unset". */
  const optNullable = <T extends z.ZodType>(schema: T) =>
    strict ? schema.nullable().optional() : schema.nullable().optional().catch(undefined);

  const version = lenient(z.number().int().min(1), 1);
  const base = { version };
  const element = {
    ...base,
    direction: lenient(z.enum(["ltr", "rtl"]).nullable(), null),
    format: lenient(z.union([z.enum(ELEMENT_FORMATS), z.number()]), ""),
    indent: lenient(z.number().int().min(0).max(1000), 0),
  };
  const url = z.string().max(CONTENT_LIMITS.maxUrlLength);
  const textLike = {
    ...base,
    text: z.string().max(CONTENT_LIMITS.maxTextLength),
    format: lenient(z.number().int().min(0), 0),
    style: lenient(z.string().max(2000), ""),
    mode: lenient(z.enum(["normal", "token", "segmented"]), "normal"),
    detail: lenient(z.number().int().min(0), 0),
  };
  const px = z.number().positive().max(100_000);

  const schemas = {
    root: z.object({ ...element }),
    paragraph: z.object({
      ...element,
      textFormat: lenient(z.number().int().min(0), 0),
      textStyle: lenient(z.string().max(2000), ""),
    }),
    text: z.object({ ...textLike }),
    linebreak: z.object({ ...base }),
    tab: z.object({ ...base, text: lenient(z.string().max(16), "\t"), format: lenient(z.number().int().min(0), 0) }),
    heading: z.object({ ...element, tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]) }),
    quote: z.object({ ...element }),
    list: z.object({
      ...element,
      listType: lenient(z.enum(["bullet", "number", "check"]), "bullet"),
      start: lenient(z.number().int().min(0).max(1_000_000), 1),
      tag: lenient(z.enum(["ul", "ol"]), "ul"),
    }),
    listitem: z.object({
      ...element,
      value: lenient(z.number().int().min(0), 1),
      checked: optNullable(z.boolean()),
    }),
    link: z.object({
      ...element,
      url,
      rel: optNullable(z.string().max(200)),
      target: optNullable(z.string().max(50)),
      title: optNullable(z.string().max(500)),
    }),
    autolink: z.object({
      ...element,
      url,
      rel: optNullable(z.string().max(200)),
      target: optNullable(z.string().max(50)),
      title: optNullable(z.string().max(500)),
      isUnlinked: lenient(z.boolean(), false),
    }),
    code: z.object({
      ...element,
      language: optNullable(z.string().max(64)),
      theme: optNullable(z.string().max(64)),
    }),
    "code-highlight": z.object({
      ...textLike,
      highlightType: optNullable(z.string().max(64)),
    }),
    horizontalrule: z.object({ ...base }),
    table: z.object({
      ...element,
      colWidths: optNullable(z.array(px).max(500)),
      rowStriping: optNullable(z.boolean()),
      frozenColumnCount: optNullable(z.number().int().min(0).max(500)),
      frozenRowCount: optNullable(z.number().int().min(0).max(500)),
    }),
    tablerow: z.object({ ...element, height: optNullable(px) }),
    tablecell: z.object({
      ...element,
      headerState: lenient(z.number().int().min(0).max(3), 0),
      colSpan: lenient(z.number().int().min(1).max(1000), 1),
      rowSpan: lenient(z.number().int().min(1).max(1000), 1),
      width: optNullable(px),
      backgroundColor: optNullable(z.string().max(100)),
      verticalAlign: optNullable(z.enum(["top", "middle", "bottom"])),
    }),
    hashtag: z.object({ ...textLike }),
    mark: z.object({ ...element, ids: optNullable(z.array(z.string().max(200)).max(1000)) }),
    overflow: z.object({ ...element }),
    image: z.object({
      ...base,
      src: z.string().min(1).max(CONTENT_LIMITS.maxDataUriLength),
      altText: lenient(z.string().max(2000), ""),
      width: lenient(z.number().min(0).max(100_000), 0),
      height: lenient(z.number().min(0).max(100_000), 0),
      maxWidth: lenient(z.number().min(0).max(100_000), 500),
      showCaption: lenient(z.boolean(), false),
    }),
    equation: z.object({
      ...base,
      equation: z.string().max(CONTENT_LIMITS.maxEquationLength),
      inline: lenient(z.boolean(), false),
    }),
    emoji: z.object({ ...textLike, className: lenient(z.string().max(200), "") }),
    mention: z.object({ ...textLike, mentionName: lenient(z.string().max(200), "") }),
    keyword: z.object({ ...textLike }),
    specialText: z.object({ ...textLike }),
    youtube: z.object({
      ...base,
      videoID: z.string().refine(isValidYouTubeId, "invalid YouTube video id"),
      format: lenient(z.union([z.enum(ELEMENT_FORMATS), z.number()]), ""),
    }),
    tweet: z.object({
      ...base,
      id: z.string().refine(isValidTweetId, "invalid tweet id"),
      format: lenient(z.union([z.enum(ELEMENT_FORMATS), z.number()]), ""),
    }),
    figma: z.object({
      ...base,
      documentID: z.string().refine(isValidFigmaId, "invalid Figma document id"),
      format: lenient(z.union([z.enum(ELEMENT_FORMATS), z.number()]), ""),
    }),
    "layout-container": z.object({ ...element, templateColumns: lenient(z.string().max(200), "") }),
    "layout-item": z.object({ ...element }),
    "collapsible-container": z.object({ ...element, open: lenient(z.boolean(), true) }),
    "collapsible-title": z.object({ ...element }),
    "collapsible-content": z.object({ ...element }),
    datetime: z.object({
      ...base,
      dateTime: z.string().max(64).refine((v) => !Number.isNaN(Date.parse(v)), "invalid date-time"),
    }),
    "page-break": z.object({ ...base }),
  } satisfies Record<SupportedNodeType, z.ZodType>;
  return schemas;
}

type Schemas = ReturnType<typeof schemasFor>;
const TOLERANT = schemasFor(false);
const STRICT = schemasFor(true);

/* ------------------------------------------------------------------ */
/* Raw JSON pre-scan                                                    */
/* ------------------------------------------------------------------ */

/**
 * Walks the raw value iteratively (no recursion) looking for things JSON cannot express or that make
 * later processing unsafe: non-finite numbers, functions/symbols/bigint/undefined, cycles/excessive depth,
 * `__proto__` keys. Returns false when the structure is too hostile to traverse at all.
 */
function scanJson(raw: unknown, ctx: Ctx): boolean {
  const stack: Array<{ v: unknown; path: string; depth: number }> = [{ v: raw, path: "$", depth: 0 }];
  let visited = 0;
  const budget = Math.max(2_000_000, ctx.limits.maxNodes * 40);
  while (stack.length > 0) {
    const { v, path, depth } = stack.pop()!;
    if (++visited > budget) {
      report(ctx, "error", "max-nodes", "document contains too many values", path);
      return false;
    }
    switch (typeof v) {
      case "number":
        if (!Number.isFinite(v)) report(ctx, "error", "non-finite-number", "NaN/Infinity is not valid JSON", path);
        break;
      case "function":
      case "symbol":
      case "bigint":
      case "undefined":
        report(ctx, "error", "non-json-value", `value of type ${typeof v} is not JSON`, path);
        break;
      case "object": {
        if (v === null) break;
        if (depth > CONTENT_LIMITS.maxJsonDepth) {
          report(ctx, "error", "max-depth", "JSON nesting is too deep (possible cycle)", path);
          return false;
        }
        if (Array.isArray(v)) {
          for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], path: `${path}[${i}]`, depth: depth + 1 });
        } else {
          const proto = Object.getPrototypeOf(v);
          if (proto !== Object.prototype && proto !== null) {
            report(ctx, "error", "non-json-value", "only plain objects are allowed", path);
            break;
          }
          for (const key of Object.keys(v as object)) {
            if (key === "__proto__") {
              report(ctx, "error", "forbidden-key", "key `__proto__` is not allowed", path);
              continue;
            }
            const child = (v as Record<string, unknown>)[key];
            // `editorState.toJSON()` leaves `undefined` properties behind (JSON.stringify drops them): treat as absent
            if (child === undefined) continue;
            stack.push({ v: child, path: `${path}.${key}`, depth: depth + 1 });
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Node traversal                                                       */
/* ------------------------------------------------------------------ */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function schemaFor(ctx: Ctx, type: SupportedNodeType): Schemas[SupportedNodeType] {
  return (ctx.strict ? STRICT : TOLERANT)[type];
}

function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return "invalid attributes";
  const p = i.path.length ? `${i.path.join(".")}: ` : "";
  return `${p}${i.message}`;
}

function checkUrlAttr(ctx: Ctx, value: string, path: string, nodeType: string, opts: { image?: boolean } = {}): void {
  if (sanitizeUrl(value, { allowDataImage: opts.image }) !== null) return;
  const dangerous = isDangerousScheme(value) && !(opts.image && /^data:image\//i.test(value.trim()));
  report(
    ctx,
    dangerous ? "error" : "warning",
    "unsafe-url",
    dangerous
      ? "URL uses a dangerous scheme; allowed: http, https, mailto, tel and relative URLs"
      : "URL is not allowed (scheme not in allowlist) and will not be rendered",
    path,
    nodeType,
  );
}

function parseNodes(ctx: Ctx, rawChildren: unknown, path: string, depth: number, parentType: string): ContentNode[] {
  if (!Array.isArray(rawChildren)) return [];
  const out: ContentNode[] = [];
  for (let i = 0; i < rawChildren.length; i++) {
    if (ctx.stopped) break;
    const nodes = parseNode(ctx, rawChildren[i], `${path}[${i}]`, depth, parentType);
    for (const n of nodes) out.push(n);
  }
  return out;
}

function parseNode(ctx: Ctx, raw: unknown, path: string, depth: number, parentType: string): ContentNode[] {
  if (ctx.stopped) return [];
  if (!isPlainObject(raw)) {
    report(ctx, "error", "invalid-node", "node must be an object", path);
    return [];
  }
  const type = raw.type;
  if (typeof type !== "string" || type === "") {
    report(ctx, "error", "invalid-node", "node.type must be a non-empty string", path);
    return [];
  }
  if (depth > ctx.limits.maxDepth) {
    reportOnce(ctx, "max-depth", "error", "max-depth", `nesting deeper than ${ctx.limits.maxDepth} levels`, path, type);
    return [];
  }
  ctx.nodes += 1;
  if (ctx.nodes > ctx.limits.maxNodes) {
    ctx.stopped = true;
    report(ctx, "error", "max-nodes", `more than ${ctx.limits.maxNodes} nodes`, path, type);
    return [];
  }
  if (depth > ctx.maxDepth) ctx.maxDepth = depth;

  /* ---------- unknown node type: preserve verbatim, flag ---------- */
  if (!isSupportedNodeType(type)) {
    ctx.unknownTypes.add(type);
    reportOnce(
      ctx,
      `unknown:${type}`,
      "warning",
      "unknown-node-type",
      `unknown node type "${type}" is preserved but skipped when rendering`,
      path,
      type,
    );
    const node: Record<string, unknown> = { ...raw };
    delete node["__proto__"];
    if (Array.isArray(raw.children)) node.children = parseNodes(ctx, raw.children, `${path}.children`, depth + 1, type);
    if (typeof node.version !== "number") node.version = 1;
    return [node as ContentNode];
  }

  /* ---------- placement ---------- */
  if (!childAllowed(parentType, type)) {
    reportOnce(
      ctx,
      `misplaced:${parentType}>${type}`,
      "warning",
      "misplaced-node",
      `<${type}> is not an expected child of <${parentType}>`,
      path,
      type,
    );
  }

  /* ---------- known type: validate attributes ---------- */
  const schema = schemaFor(ctx, type) as z.ZodType<Record<string, unknown>>;
  const parsed = schema.safeParse(raw);
  const isElement = ELEMENT_TYPES.has(type);

  let attrs: Record<string, unknown>;
  if (!parsed.success) {
    report(ctx, "error", "invalid-attribute", `invalid <${type}>: ${firstIssue(parsed.error)}`, path, type);
    if (isElement) {
      // unwrap: keep the content, lose the broken wrapper
      return parseNodes(ctx, raw.children, `${path}.children`, depth + 1, type);
    }
    return [];
  }
  attrs = parsed.data;

  // version policy
  const version = typeof raw.version === "number" ? raw.version : 1;
  if (version > 1) {
    reportOnce(
      ctx,
      `version:${type}`,
      "warning",
      "newer-node-version",
      `<${type}> has version ${version}; BCF v1 understands version 1 (rendered best-effort)`,
      path,
      type,
    );
  }

  const node: Record<string, unknown> = { ...raw, ...attrs, type };
  delete node["__proto__"];
  // zod leaves out keys whose value is `undefined`; keep them out of the tree as well
  for (const k of Object.keys(node)) if (node[k] === undefined) delete node[k];
  if (typeof node.version !== "number") node.version = 1;

  /* ---------- per-type semantic checks / normalisation ---------- */
  switch (type) {
    case "link":
    case "autolink":
      checkUrlAttr(ctx, node.url as string, `${path}.url`, type);
      break;
    case "image":
      checkUrlAttr(ctx, node.src as string, `${path}.src`, type, { image: true });
      node.caption = parseCaption(ctx, raw.caption, `${path}.caption`, depth + 1);
      if (node.caption === undefined) delete node.caption;
      break;
    case "list": {
      // `tag` is derived, never trusted
      node.tag = node.listType === "number" ? "ol" : "ul";
      break;
    }
    case "equation":
      break;
    default:
      break;
  }

  if (isElement) {
    node.children = parseNodes(ctx, raw.children, `${path}.children`, depth + 1, type);
  } else if ("children" in node) {
    // leaf node types never keep children
    delete node.children;
  }
  return [node as unknown as ContentNode];
}

function parseCaption(ctx: Ctx, raw: unknown, path: string, depth: number): { editorState: { root: RootNode } } | undefined {
  if (raw === undefined || raw === null) return undefined;
  const root = isPlainObject(raw) && isPlainObject(raw.editorState) ? raw.editorState.root : undefined;
  if (!isPlainObject(root) || !Array.isArray(root.children)) {
    report(ctx, "warning", "invalid-attribute", "image.caption.editorState.root is malformed; caption ignored", path, "image");
    return undefined;
  }
  const children = parseNodes(ctx, root.children, `${path}.editorState.root.children`, depth, "root");
  return {
    editorState: {
      root: { ...root, type: "root", version: 1, children } as unknown as RootNode,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Entry points                                                         */
/* ------------------------------------------------------------------ */

/** A document with no blocks at all (what unusable input degrades to). */
function blankContent(): Content {
  return { root: { children: [], direction: null, format: "", indent: 0, type: "root", version: 1 } };
}

/** The editor's empty state: one empty paragraph. */
export function emptyContent(): Content {
  return {
    root: {
      children: [
        {
          children: [],
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
          textFormat: 0,
          textStyle: "",
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

const PARSED = new WeakSet<object>();

/** Marks a tree as produced by this module (lets the renderers skip re-parsing). */
export function isParsedContent(content: unknown): content is Content {
  return typeof content === "object" && content !== null && PARSED.has(content);
}

function newCtx(strict: boolean, limits?: Partial<Limits>): Ctx {
  return {
    strict,
    errors: [],
    warnings: [],
    nodes: 0,
    maxDepth: 0,
    unknownTypes: new Set(),
    reportedOnce: new Set(),
    stopped: false,
    limits: {
      maxDepth: limits?.maxDepth ?? CONTENT_LIMITS.maxDepth,
      maxNodes: limits?.maxNodes ?? CONTENT_LIMITS.maxNodes,
      maxBytes: limits?.maxBytes ?? CONTENT_LIMITS.maxBytes,
    },
  };
}

function run(input: unknown, ctx: Ctx): { content: Content; valid: boolean } {
  let raw = input;
  if (typeof raw === "string") {
    if (raw.length > ctx.limits.maxBytes) {
      report(ctx, "error", "max-bytes", "serialized content is too large", "$");
      return { content: blankContent(), valid: false };
    }
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      report(ctx, "error", "invalid-json", `content is not valid JSON: ${(e as Error).message}`, "$");
      return { content: blankContent(), valid: false };
    }
  }

  if (!scanJson(raw, ctx)) return { content: blankContent(), valid: false };

  if (!isPlainObject(raw) || !isPlainObject(raw.root)) {
    report(ctx, "error", "invalid-root", 'content must be an object of the form {"root": {...}}', "$");
    return { content: blankContent(), valid: false };
  }

  let bytes = 0;
  try {
    bytes = JSON.stringify(raw).length;
  } catch {
    report(ctx, "error", "non-json-value", "content is not JSON-serialisable", "$");
    return { content: blankContent(), valid: false };
  }
  if (bytes > ctx.limits.maxBytes) {
    report(ctx, "error", "max-bytes", `serialized content is ${bytes} bytes; limit is ${ctx.limits.maxBytes}`, "$");
  }

  const rawRoot = raw.root;
  if (rawRoot.type !== "root") {
    report(ctx, "error", "invalid-root", 'root.type must be "root"', "root", String(rawRoot.type));
  }
  if (!Array.isArray(rawRoot.children)) {
    report(ctx, "error", "invalid-root", "root.children must be an array", "root.children", "root");
    return { content: blankContent(), valid: false };
  }
  const attrs = (ctx.strict ? STRICT : TOLERANT).root.safeParse(rawRoot);
  if (!attrs.success) {
    report(ctx, "error", "invalid-attribute", `invalid <root>: ${firstIssue(attrs.error)}`, "root", "root");
  }
  const children = parseNodes(ctx, rawRoot.children, "root.children", 1, "root");
  const root = {
    ...rawRoot,
    ...(attrs.success ? attrs.data : {}),
    type: "root",
    version: typeof rawRoot.version === "number" ? rawRoot.version : 1,
    children,
  } as unknown as RootNode;
  for (const k of Object.keys(root)) if ((root as Record<string, unknown>)[k] === undefined) delete (root as Record<string, unknown>)[k];
  const content: Content = { root };
  const valid = ctx.errors.length === 0 && !ctx.stopped && rawRoot.type === "root";
  return { content, valid };
}

function statsOf(ctx: Ctx): ParseStats {
  return { nodes: ctx.nodes, maxDepth: ctx.maxDepth, unknownTypes: [...ctx.unknownTypes].sort() };
}

/**
 * Tolerant parse. Never throws. Returns a normalised tree (always renderable) plus warnings for everything
 * that had to be repaired: dropped/unwrapped invalid nodes, defaulted attributes, unknown node types
 * (kept verbatim), depth/size limits.
 *
 * Store the ORIGINAL json, not the parsed tree, if you want byte-for-byte preservation. The parsed tree
 * preserves unknown nodes/properties too, but may default or repair known attributes.
 */
export function parseContent(json: unknown, limits?: Partial<Limits>): ParseResult {
  if (isParsedContent(json)) {
    return { content: json, warnings: [], valid: true, stats: { nodes: 0, maxDepth: 0, unknownTypes: [] } };
  }
  // tolerant: report everything as warnings
  const ctx = newCtx(false, limits);
  let result: { content: Content; valid: boolean };
  try {
    result = run(json, ctx);
  } catch (e) {
    ctx.warnings.push({ code: "invalid-root", message: `unexpected parser failure: ${(e as Error).message}`, path: "$" });
    result = { content: blankContent(), valid: false };
  }
  PARSED.add(result.content);
  return {
    content: result.content,
    warnings: ctx.warnings,
    valid: result.valid && ctx.warnings.every((w) => w.code !== "max-nodes" && w.code !== "max-depth" && w.code !== "invalid-root"),
    stats: statsOf(ctx),
  };
}

/**
 * Strict structural validation (use before storing). `ok` is false when there is at least one error.
 * Unknown node types and misplaced nodes are reported as warnings only, so content written by a newer
 * editor can still be stored (forward compatibility).
 */
export function validateContent(json: unknown, limits?: Partial<Limits>): ValidationResult {
  const ctx = newCtx(true, limits);
  try {
    run(json, ctx);
  } catch (e) {
    ctx.errors.push({ code: "invalid-root", message: `unexpected validator failure: ${(e as Error).message}`, path: "$" });
  }
  return { ok: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings, stats: statsOf(ctx) };
}
