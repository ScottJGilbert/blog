/**
 * Inline-style sanitising. Only a tiny set of properties is ever emitted and each value is validated
 * against a strict grammar; anything else is dropped. Nothing from `style` strings is ever passed
 * through verbatim.
 */

export type StyleProp = "color" | "background-color" | "font-size" | "font-family" | "text-align";

/** Allowlisted properties for text `style` strings. */
export const TEXT_STYLE_PROPS: readonly StyleProp[] = [
  "color",
  "background-color",
  "font-size",
  "font-family",
  "text-align",
];

/** Allowlisted properties for `code-highlight` (syntax token) styles. */
export const CODE_STYLE_PROPS = ["color", "background-color", "font-style", "font-weight", "text-decoration"] as const;

const NUM = String.raw`-?\d{1,4}(?:\.\d{1,4})?`;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = new RegExp(String.raw`^rgba?\(\s*${NUM}%?\s*[, ]\s*${NUM}%?\s*[, ]\s*${NUM}%?(?:\s*[,/]\s*${NUM}%?)?\s*\)$`, "i");
const HSL_COLOR = new RegExp(String.raw`^hsla?\(\s*${NUM}(?:deg)?\s*[, ]\s*${NUM}%\s*[, ]\s*${NUM}%(?:\s*[,/]\s*${NUM}%?)?\s*\)$`, "i");
const NAMED_COLOR = /^[a-z]{3,24}$/i;
const COLOR_KEYWORDS_BLOCKED = new Set(["inherit", "initial", "unset", "revert", "expression", "url", "var", "env"]);
const FONT_SIZE = /^(\d{1,3}(?:\.\d{1,3})?)(px|pt|em|rem|%)$/i;
const FONT_FAMILY_NAME = /^[A-Za-z0-9 _.-]{1,60}$/;
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace"]);

export function isSafeColor(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 64) return false;
  if (HEX_COLOR.test(v) || RGB_COLOR.test(v) || HSL_COLOR.test(v)) return true;
  if (v.toLowerCase() === "transparent" || v.toLowerCase() === "currentcolor") return true;
  return NAMED_COLOR.test(v) && !COLOR_KEYWORDS_BLOCKED.has(v.toLowerCase());
}

export function safeFontSize(value: string): string | null {
  const m = FONT_SIZE.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const max = unit === "%" ? 500 : unit === "em" || unit === "rem" ? 20 : 400;
  if (!(n > 0 && n <= max)) return null;
  return `${n}${unit}`;
}

export function safeFontFamily(value: string): string | null {
  const parts = value.split(",").map((p) => p.trim());
  if (parts.length === 0 || parts.length > 8) return null;
  const out: string[] = [];
  for (const raw of parts) {
    let name = raw;
    if (
      name.length >= 2 &&
      ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'")))
    ) {
      name = name.slice(1, -1).trim();
    }
    if (!FONT_FAMILY_NAME.test(name) || name.length === 0) return null;
    out.push(GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `'${name}'`);
  }
  return out.join(", ");
}

export function safeTextAlign(value: string): string | null {
  const v = value.trim().toLowerCase();
  return ["left", "right", "center", "justify", "start", "end"].includes(v) ? v : null;
}

/** Split `a: b; c: d` into declarations, respecting quotes and parentheses. */
export function splitDeclarations(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cur = "";
  let quote: string | null = null;
  let depth = 0;
  const flush = () => {
    const idx = cur.indexOf(":");
    if (idx > 0) {
      const prop = cur.slice(0, idx).trim().toLowerCase();
      const val = cur.slice(idx + 1).trim();
      if (prop && val) out.push([prop, val]);
    }
    cur = "";
  };
  for (let i = 0; i < style.length && i < 4000; i++) {
    const ch = style[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === ";" && depth === 0) {
      flush();
    } else {
      cur += ch;
    }
  }
  flush();
  return out;
}

/** Characters that never appear in a legitimate value of the properties we allow. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_VALUE = /[\\<>{}@\u0000-\u001F]|\/\*|\*\/|url\s*\(|expression\s*\(|javascript:|var\s*\(|env\s*\(|calc\s*\(|attr\s*\(|image\s*\(|!important/i;

/**
 * Parse an editor `style` string into sanitised `[prop, value]` pairs (later declarations win,
 * output order follows `allowed`). Returns the rejected property names too, for warnings.
 */
export function sanitizeStyle(
  style: unknown,
  allowed: readonly string[] = TEXT_STYLE_PROPS,
): { declarations: Array<[string, string]>; rejected: string[] } {
  const rejected: string[] = [];
  if (typeof style !== "string" || style.trim() === "") return { declarations: [], rejected };
  const found = new Map<string, string>();
  for (const [prop, rawValue] of splitDeclarations(style)) {
    if (!allowed.includes(prop)) {
      rejected.push(prop);
      continue;
    }
    if (FORBIDDEN_VALUE.test(rawValue)) {
      rejected.push(prop);
      continue;
    }
    let value: string | null = null;
    switch (prop) {
      case "color":
      case "background-color":
        value = isSafeColor(rawValue) ? rawValue.trim() : null;
        break;
      case "font-size":
        value = safeFontSize(rawValue);
        break;
      case "font-family":
        value = safeFontFamily(rawValue);
        break;
      case "text-align":
        value = safeTextAlign(rawValue);
        break;
      case "font-style":
        value = ["normal", "italic", "oblique"].includes(rawValue.trim().toLowerCase()) ? rawValue.trim().toLowerCase() : null;
        break;
      case "font-weight":
        value = /^(normal|bold|[1-9]00)$/i.test(rawValue.trim()) ? rawValue.trim().toLowerCase() : null;
        break;
      case "text-decoration":
        value = /^(none|underline|line-through)$/i.test(rawValue.trim()) ? rawValue.trim().toLowerCase() : null;
        break;
    }
    if (value === null) rejected.push(prop);
    else found.set(prop, value);
  }
  const declarations: Array<[string, string]> = [];
  for (const prop of allowed) {
    const v = found.get(prop);
    if (v !== undefined) declarations.push([prop, v]);
  }
  return { declarations, rejected };
}

/** `[["color","red"]]` → `color:red` (no trailing semicolon). */
export function stylePairsToString(pairs: Array<[string, string]>): string {
  return pairs.map(([p, v]) => `${p}:${v}`).join(";");
}

/** Validate `grid-template-columns` for layout containers. */
export function safeGridTemplateColumns(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 120) return null;
  const stripped = v.replace(/(?<![a-z])(?:fr|px|em|rem|vw|auto|min-content|max-content|minmax|repeat|fit-content)(?![a-z])/gi, "");
  if (!/^[\d\s.,()%-]*$/.test(stripped)) return null;
  // balanced parentheses, reasonable number of tracks
  let depth = 0;
  for (const ch of v) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  return v.replace(/\s+/g, " ");
}

/** Positive finite number within bounds, else null. */
export function safePx(value: unknown, max = 4000): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) return null;
  return Math.round(value * 100) / 100;
}
