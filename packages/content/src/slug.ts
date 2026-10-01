/**
 * Slug generation shared by `extractToc` and the heading ids emitted by `renderHtml`.
 */

/** Lowercase ASCII slug: diacritics stripped, non-alphanumerics collapsed to `-`. Never empty. */
export function slugify(text: string, fallback = "section"): string {
  const slug = String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/** Hands out unique slugs: `intro`, `intro-2`, `intro-3`, … */
export class SlugAllocator {
  private used = new Set<string>();
  constructor(private prefix = "") {}
  next(text: string): string {
    const base = this.prefix + slugify(text);
    let id = base;
    let n = 1;
    while (this.used.has(id)) {
      n += 1;
      id = `${base}-${n}`;
    }
    this.used.add(id);
    return id;
  }
}
