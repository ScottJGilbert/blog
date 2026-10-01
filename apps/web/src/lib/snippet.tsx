import type { ReactNode } from "react";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode the few entities the API's escaper emits. Anything unknown is left as-is (React escapes it on render). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/**
 * Render an API search snippet (`ts_headline` output: escaped text with `<mark>` highlights) WITHOUT
 * dangerouslySetInnerHTML: the string is split on the mark tags, every segment becomes a React text node (so React
 * escapes it) and only the segments between <mark>…</mark> are wrapped in a real <mark>. Any other tag-like text is
 * stripped.
 */
export function renderSnippet(snippet: string): ReactNode[] {
  const parts = snippet.split(/(<\/?mark>)/gi);
  const nodes: ReactNode[] = [];
  let marked = false;
  parts.forEach((part, i) => {
    const lower = part.toLowerCase();
    if (lower === "<mark>") {
      marked = true;
    } else if (lower === "</mark>") {
      marked = false;
    } else if (part) {
      const text = decodeEntities(part.replace(/<[^>]*>/g, ""));
      if (!text) return;
      nodes.push(
        marked ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 font-semibold text-accent-soft-fg">
            {text}
          </mark>
        ) : (
          text
        ),
      );
    }
  });
  return nodes;
}
