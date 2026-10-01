import Link from "next/link";
import { clsx } from "clsx";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

interface PaginationProps {
  /** 1-based current page. */
  currentPage: number;
  totalPages: number;
  /** Build the href for a page, e.g. `(p) => p === 1 ? "/engineering" : `/engineering?page=${p}``. */
  getHref: (page: number) => string;
  /** Accessible name; change it if a page has more than one pager. */
  label?: string;
  className?: string;
}

type Item = number | "gap-start" | "gap-end";

/** 1 … (current-1) current (current+1) … last */
function buildItems(current: number, total: number): Item[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: Item[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push("gap-start");
  for (let page = start; page <= end; page++) items.push(page);
  if (end < total - 1) items.push("gap-end");
  items.push(total);
  return items;
}

const cell =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 text-sm font-bold";

/**
 * Presentational pager (server component, plain links so it works without JS).
 * Renders nothing for a single page. Current page gets aria-current="page".
 */
export function Pagination({
  currentPage,
  totalPages,
  getHref,
  label = "Pagination",
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  const current = Math.min(Math.max(1, currentPage), totalPages);
  const hasPrev = current > 1;
  const hasNext = current < totalPages;

  const step = (enabled: boolean, page: number, dir: "prev" | "next") => {
    const Icon = dir === "prev" ? LuChevronLeft : LuChevronRight;
    const text = dir === "prev" ? "Previous" : "Next";
    const content = (
      <>
        {dir === "prev" && <Icon aria-hidden className="size-4" />}
        <span className="max-sm:sr-only">{text}</span>
        {dir === "next" && <Icon aria-hidden className="size-4" />}
      </>
    );
    return enabled ? (
      <Link
        href={getHref(page)}
        rel={dir}
        aria-label={`${text} page`}
        className={clsx(
          cell,
          "gap-1 border border-border-strong text-fg transition-colors hover:bg-surface-2",
        )}
      >
        {content}
      </Link>
    ) : (
      <span
        aria-disabled="true"
        className={clsx(
          cell,
          "gap-1 border border-border text-muted opacity-60",
        )}
      >
        {content}
      </span>
    );
  };

  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-2">
        <li>{step(hasPrev, current - 1, "prev")}</li>
        {/* Small screens: compact "Page x of y" instead of the number strip. */}
        <li className="px-2 text-sm font-semibold text-muted sm:hidden">
          Page {current} of {totalPages}
        </li>
        {buildItems(current, totalPages).map((item) =>
          typeof item === "string" ? (
            <li
              key={item}
              aria-hidden
              className="hidden px-1 text-muted select-none sm:block"
            >
              &hellip;
            </li>
          ) : (
            <li key={item} className="hidden sm:block">
              <Link
                href={getHref(item)}
                aria-label={`Page ${item}`}
                aria-current={item === current ? "page" : undefined}
                className={clsx(
                  cell,
                  "tabular-nums transition-colors",
                  item === current
                    ? "bg-accent text-accent-fg"
                    : "text-fg hover:bg-surface-2",
                )}
              >
                {item}
              </Link>
            </li>
          ),
        )}
        <li>{step(hasNext, current + 1, "next")}</li>
      </ul>
    </nav>
  );
}
