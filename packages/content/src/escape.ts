/** HTML escaping helpers. Everything user-controlled goes through one of these. */

// Control characters that are invalid/ignored in HTML text (keeps \t \n \r).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F￾￿]/g;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Escape a string for use as HTML text or inside a double/single-quoted attribute. */
export function escapeHtml(input: string): string {
  return String(input).replace(CONTROL_CHARS, "").replace(/[&<>"'`]/g, (c) => ESCAPES[c]!);
}

/** Alias that documents intent: value is destined for an attribute. */
export const escapeAttr = escapeHtml;

/**
 * Escape text for flow content. Runs of 2+ spaces are kept visible (`&nbsp;`), tabs become spaces and
 * `\n` becomes `<br>`, so rendering does not depend on `white-space: pre-wrap` being present.
 */
export function escapeText(input: string): string {
  let out = escapeHtml(input);
  if (out.includes("\t")) out = out.replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;");
  if (out.includes("  ")) out = out.replace(/ {2,}/g, (m) => "&nbsp;".repeat(m.length - 1) + " ");
  if (out.includes("\n") || out.includes("\r")) out = out.replace(/\r\n|\r|\n/g, "<br>");
  return out;
}

/** Escape source text destined for a `<pre>` (whitespace preserved by the element itself). */
export function escapePre(input: string): string {
  return escapeHtml(input);
}
