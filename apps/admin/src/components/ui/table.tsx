import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** Horizontally scrollable, keyboard-focusable and labelled region around a wide table (WCAG 2.1.1 / axe scrollable-region-focusable). */
export function TableScroll({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("relative overflow-x-auto overscroll-x-contain", className)}>
      {children}
    </div>
  );
}

export function Table({ className, ...rest }: ComponentProps<"table">) {
  return <table className={cn("w-full min-w-[40rem] border-collapse text-left text-sm", className)} {...rest} />;
}
export function THead({ className, ...rest }: ComponentProps<"thead">) {
  return <thead className={cn("border-b border-edge bg-panel-2/60 text-xs uppercase tracking-wide text-muted", className)} {...rest} />;
}
export function TBody({ className, ...rest }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-edge", className)} {...rest} />;
}
export function Tr({ className, ...rest }: ComponentProps<"tr">) {
  return <tr className={cn("align-middle hover:bg-panel-2/50", className)} {...rest} />;
}
export function Th({ className, scope = "col", ...rest }: ComponentProps<"th">) {
  return <th scope={scope} className={cn("px-4 py-2.5 font-semibold", className)} {...rest} />;
}
export function Td({ className, ...rest }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3", className)} {...rest} />;
}

/**
 * Classes for the trailing "Actions" column of a wide table: it stays pinned to the right edge of the scroll region, so
 * on a phone the row menu / delete button is reachable without scrolling sideways first.
 */
export const STICKY_ACTION_TH = "sticky right-0 z-[1] bg-panel-2";
export const STICKY_ACTION_TD = "sticky right-0 bg-panel shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.15)]";
