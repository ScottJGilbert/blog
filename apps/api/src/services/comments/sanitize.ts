/**
 * Comment bodies are plain text. Normalise line endings, drop control characters (except tab/newline) and
 * invisible bidi-override characters, trim trailing whitespace per line, collapse runs of blank lines to one blank
 * line and trim the result. Never produces HTML; the clients render it as text.
 */
export function sanitizeCommentBody(input: string): string {
  return (
    input
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      // zero-width + bidi embedding/override/isolate characters (text spoofing), BOM
      .replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
