import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";

export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
  tone?: "warn" | "danger";
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8125rem] font-medium text-muted">{label}</p>
        {icon ? (
          <span aria-hidden className="text-muted">
            {icon}
          </span>
        ) : null}
      </div>
      <p className={cn("mt-1 text-3xl font-semibold tabular-nums tracking-tight", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[0.8125rem] text-muted">{hint}</p> : null}
    </>
  );
  const cls = "block rounded-xl border border-edge bg-panel p-4 min-h-[7.25rem]";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-edge-strong hover:bg-panel-2")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
