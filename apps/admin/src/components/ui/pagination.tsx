import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import type { PaginationMeta } from "@blog/shared";
import { Button } from "./button";

export function Pagination({
  meta,
  onPage,
  busy,
  noun = "items",
}: {
  meta: PaginationMeta;
  onPage: (page: number) => void;
  busy?: boolean;
  noun?: string;
}) {
  const { page, pageSize, total, totalPages } = meta;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-3 text-sm">
      <p className="text-muted" aria-live="polite">
        {total === 0 ? `No ${noun}` : `${from}–${to} of ${total.toLocaleString("en")} ${noun}`}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1 || busy} icon={<LuChevronLeft aria-hidden className="size-4" />}>
          Previous
        </Button>
        <span className="min-w-[5.5rem] text-center tabular-nums text-muted">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages || busy}>
          Next
          <LuChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
