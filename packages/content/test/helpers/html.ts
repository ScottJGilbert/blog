/** Minimal HTML inspection helpers for tests (no DOM needed). */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Returns a list of structural problems (unbalanced / mis-nested tags). Empty array = well formed. */
export function checkWellFormed(html: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const selfClosing = m[3]!.trim().endsWith("/");
    if (VOID.has(tag) || selfClosing) {
      if (closing) problems.push(`stray closing </${tag}>`);
      continue;
    }
    if (!closing) stack.push(tag);
    else {
      const top = stack.pop();
      if (top !== tag) problems.push(`expected </${top}> but found </${tag}>`);
    }
  }
  if (stack.length) problems.push(`unclosed: ${stack.join(",")}`);
  return problems;
}

export function classesOf(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1]!.split(/\s+/)) if (c) out.add(c);
  return out;
}

export function tagsOf(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)) out.add(m[1]!.toLowerCase());
  return out;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#96": "`", nbsp: " ", "#10": "\n" };
export function decode(s: string): string {
  return s.replace(/&(#?\w+);/g, (_, n: string) => ENT[n] ?? `&${n};`);
}

/** Visible-ish text: tags stripped, entities decoded, whitespace collapsed. */
export function textOf(html: string): string {
  return decode(html.replace(/<[^>]*>/g, "")).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Every `name="value"` pair on every tag, for security assertions. */
export function allAttributes(html: string): Array<{ tag: string; name: string; value: string }> {
  const out: Array<{ tag: string; name: string; value: string }> = [];
  for (const tm of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    for (const am of tm[2]!.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      out.push({ tag: tm[1]!.toLowerCase(), name: am[1]!.toLowerCase(), value: decode(am[2] ?? am[3] ?? am[4] ?? "") });
    }
  }
  return out;
}
