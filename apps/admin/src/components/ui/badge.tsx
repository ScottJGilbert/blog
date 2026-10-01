import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted border-edge",
  brand: "bg-brand-soft text-brand border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  published: "ok",
  visible: "ok",
  confirmed: "ok",
  sent: "ok",
  draft: "neutral",
  pending: "warn",
  scheduled: "info",
  sending: "info",
  hidden: "warn",
  archived: "neutral",
  deleted: "danger",
  failed: "danger",
  unsubscribed: "neutral",
  banned: "danger",
  admin: "brand",
  reader: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}
