import { clsx } from "clsx";

/**
 * Placeholder block. Always give it explicit dimensions (height/aspect) that
 * match the content it stands in for so swapping in real content shifts nothing.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx(
        "rounded-control bg-surface-2 motion-safe:animate-pulse",
        className,
      )}
    />
  );
}
