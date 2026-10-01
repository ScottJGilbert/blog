/**
 * Server-side KaTeX with a small memo cache. Output requires `katex/dist/katex.min.css` on the page.
 */
import katex from "katex";

const CACHE = new Map<string, string>();
const CACHE_MAX = 500;

/** Returns KaTeX markup (`<span class="katex">…`), or null when KaTeX itself blows up. */
export function renderKatex(equation: string, displayMode: boolean): string | null {
  const key = `${displayMode ? 1 : 0}:${equation}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit;
  try {
    const html = katex.renderToString(equation, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      output: "htmlAndMathml",
      errorColor: "#cc0000",
      maxSize: 50,
      maxExpand: 1000,
    });
    if (CACHE.size >= CACHE_MAX) {
      const first = CACHE.keys().next().value;
      if (first !== undefined) CACHE.delete(first);
    }
    CACHE.set(key, html);
    return html;
  } catch {
    return null;
  }
}
