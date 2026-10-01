/**
 * Display names (users): single line, no control / invisible / bidi-override characters (NUL would also make Postgres
 * reject the row with a 500), whitespace collapsed, at most `max` characters. Returns "" when nothing printable is left.
 */
export function sanitizeDisplayName(input: string, max = 80): string {
  return (
    input
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
      // zero-width + bidi embedding/override/isolate characters (spoofing), BOM, line/paragraph separators
      .replace(/[\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
      .trim()
  );
}

/** Break Go-template delimiters (`{{`) with a zero-width space so user text can never be compiled by listmonk. */
export const defuseTemplateTags = (s: string): string => s.replaceAll("{{", "{\u200b{");
