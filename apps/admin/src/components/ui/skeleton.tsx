import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-panel-2 motion-reduce:animate-none", className)} />;
}

/** Fixed-height placeholder rows so the table does not jump when data arrives. */
export function TableSkeleton({ rows = 8, cols = 5, label = "Loading" }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-edge">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-14 items-center gap-4 px-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-2/5" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("space-y-3 rounded-xl border border-edge bg-panel p-4", className)}>
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
    </div>
  );
}
