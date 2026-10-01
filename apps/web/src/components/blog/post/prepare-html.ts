/**
 * Small, safe post-processing of the API's `contentHtml` (produced by @blog/content, so every text node and attribute
 * is already escaped and `<` never appears raw inside text; regexes over tags are therefore sound):
 *  - the page owns the only <h1>: if the content has h1s, every heading level shifts down by one;
 *  - tables get a focusable scroll region so wide tables never cause horizontal page scroll (WCAG 1.4.10, 2.1.1).
 */
export function prepareContentHtml(html: string): string {
  let out = html;
  if (/<h1[\s>]/.test(out)) {
    out = out.replace(/<(\/?)h([1-6])(?=[\s>])/g, (_m, slash: string, level: string) => `<${slash}h${Math.min(6, Number(level) + 1)}`);
  }
  if (out.includes("<table")) {
    out = out
      .replace(/<table(?=[\s>])/g, '<div class="post-table-wrap" role="region" aria-label="Table" tabindex="0"><table')
      .replace(/<\/table>/g, "</table></div>");
  }
  return out;
}

export const hasEquations = (html: string) => html.includes('class="katex');
