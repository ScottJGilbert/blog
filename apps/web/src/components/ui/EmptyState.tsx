import { clsx } from "clsx";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Small status line, e.g. "status: compilation_in_progress". */
  status?: string;
  action?: ReactNode;
  /** Heading level for the title (default h2: the page owns the h1). */
  as?: "h2" | "h3";
  className?: string;
}

/** Intentional-looking "nothing here (yet)" panel; inherits the section theme. */
export function EmptyState({
  icon,
  title,
  description,
  status,
  action,
  as: Heading = "h2",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "section-motif rounded-panel border border-dashed border-border-strong bg-surface px-6 py-14 text-center sm:px-12",
        className,
      )}
    >
      <div className="mx-auto flex max-w-md flex-col items-center">
        {icon && (
          <div
            aria-hidden
            className="mb-5 flex size-14 items-center justify-center rounded-card bg-accent-soft text-2xl text-accent-soft-fg"
          >
            {icon}
          </div>
        )}
        <Heading className="text-2xl text-fg">{title}</Heading>
        {description && <p className="mt-3 text-muted">{description}</p>}
        {status && (
          <p className="mt-6 inline-flex max-w-full items-center gap-2 rounded-full bg-fg px-3 py-1.5 font-accent text-xs font-semibold text-bg">
            <span
              aria-hidden
              className="size-2 rounded-full bg-accent-soft motion-safe:animate-pulse"
            />
            {status}
          </p>
        )}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}
