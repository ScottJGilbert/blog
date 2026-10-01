"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/** WAI-ARIA tabs (automatic activation, roving tabindex, Arrow/Home/End). One shared tabpanel whose content the caller swaps. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  children?: ReactNode;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const idx = Math.max(0, tabs.findIndex((t) => t.id === value));

  function onKeyDown(e: KeyboardEvent) {
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const t = tabs[next];
    onChange(t.id);
    refs.current[t.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-edge px-2">
        {tabs.map((t) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              role="tab"
              type="button"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap",
                selected ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span className="rounded-full bg-panel-2 px-1.5 text-xs tabular-nums text-muted">{t.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`}>
        {children}
      </div>
    </div>
  );
}
