import Link from "next/link";
import { clsx } from "clsx";
import { listingHref } from "@/lib/paths";

export interface TagFacet {
  slug: string;
  name: string;
  count?: number;
}

const chip =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors";

/** Filter chips as plain links (works without JS, shareable URLs). `base` is the listing path, `active` a tag slug. */
export function TagFilter({
  base,
  tags,
  active,
  extra,
  label = "Filter by tag",
  showAll = true,
}: {
  base: string;
  tags: TagFacet[];
  active?: string;
  /** Query params kept when switching tag (e.g. q, section on /search). */
  extra?: { q?: string; section?: string };
  label?: string;
  /** Leading "All" chip that clears the tag filter. */
  showAll?: boolean;
}) {
  if (tags.length === 0) return null;
  return (
    <nav aria-label={label} className="pb-8">
      <ul className="flex flex-wrap gap-2">
        {showAll && <li>
          <Link
            href={listingHref(base, extra)}
            aria-current={active ? undefined : "true"}
            className={clsx(
              chip,
              !active ? "border-accent bg-accent text-accent-fg" : "border-border-strong text-fg hover:bg-surface-2",
            )}
          >
            All
          </Link>
        </li>}
        {tags.map((tag) => {
          const isActive = tag.slug === active;
          return (
            <li key={tag.slug}>
              <Link
                href={listingHref(base, { ...extra, tag: tag.slug })}
                aria-current={isActive ? "true" : undefined}
                className={clsx(
                  chip,
                  isActive ? "border-accent bg-accent text-accent-fg" : "border-border-strong text-fg hover:bg-surface-2",
                )}
              >
                {tag.name}
                {tag.count !== undefined && (
                  <span className={clsx("font-accent text-xs tabular-nums", isActive ? "" : "text-muted")}>
                    <span className="sr-only"> (</span>
                    {tag.count}
                    <span className="sr-only"> posts)</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Distinct tags (with counts) of a set of posts, most used first. */
export function facetsFromPosts(posts: { tags: { slug: string; name: string }[] }[]): TagFacet[] {
  const map = new Map<string, TagFacet>();
  for (const post of posts) {
    for (const t of post.tags) {
      const f = map.get(t.slug);
      if (f) f.count = (f.count ?? 0) + 1;
      else map.set(t.slug, { slug: t.slug, name: t.name, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
}
