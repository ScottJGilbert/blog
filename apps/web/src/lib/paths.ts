import type { Section } from "@blog/shared";

export const SECTION_LABEL: Record<Section, string> = {
  personal: "Personal",
  engineering: "Engineering",
};

export function postHref(section: Section, slug: string): string {
  return `/${section}/${encodeURIComponent(slug)}`;
}

/** Listing href with optional filters; page 1 is the canonical (no ?page=). */
export function listingHref(
  base: string,
  params: { page?: number; tag?: string; q?: string; section?: string } = {},
): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.section) sp.set("section", params.section);
  if (params.tag) sp.set("tag", params.tag);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Parse `?page=` defensively (1..1000). */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
}

const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Tag slugs only; anything else is ignored rather than sent to the API. */
export function parseTag(value: string | string[] | undefined): string | undefined {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  return raw && raw.length <= 100 && TAG_RE.test(raw) ? raw : undefined;
}

export function parseSection(value: string | string[] | undefined): Section | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "personal" || raw === "engineering" ? raw : undefined;
}
