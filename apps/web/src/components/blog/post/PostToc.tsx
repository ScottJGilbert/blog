import type { TocItem } from "@blog/shared";
import { clsx } from "clsx";
import { LuChevronDown } from "react-icons/lu";

function TocList({ toc }: { toc: TocItem[] }) {
  const min = Math.min(...toc.map((t) => t.level));
  return (
    <ol className="grid gap-0.5">
      {toc.map((item) => (
        <li key={item.id} style={{ paddingInlineStart: `${Math.min(item.level - min, 3) * 0.875}rem` }}>
          <a
            href={`#${item.id}`}
            className={clsx(
              "flex min-h-8 items-center rounded-control px-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-accent xl:min-h-0 xl:py-1",
              item.level - min === 0 && "font-semibold",
            )}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Collapsible table of contents for narrow screens (native <details>: no JS). Hidden from xl up. */
export function PostTocDisclosure({ toc }: { toc: TocItem[] }) {
  if (toc.length < 2) return null;
  return (
    <details className="group mb-8 rounded-card border border-border bg-surface xl:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 font-bold [&::-webkit-details-marker]:hidden">
        On this page
        <LuChevronDown aria-hidden className="size-5 transition-transform group-open:rotate-180" />
      </summary>
      <nav aria-label="Table of contents" className="border-t border-border p-2">
        <TocList toc={toc} />
      </nav>
    </details>
  );
}

/** Sticky sidebar variant for wide screens (xl+). */
export function PostTocSidebar({ toc }: { toc: TocItem[] }) {
  if (toc.length < 2) return null;
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-[calc(var(--spacing-header)+2rem)] max-h-[calc(100dvh-var(--spacing-header)-4rem)] overflow-y-auto">
        <nav aria-label="On this page">
          <p className="eyebrow mb-3 text-fg">On this page</p>
          <TocList toc={toc} />
        </nav>
      </div>
    </aside>
  );
}
