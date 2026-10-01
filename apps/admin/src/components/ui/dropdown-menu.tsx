"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  /** external/plain anchor (opens in new tab) instead of next/link */
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** radio-style item: renders `menuitemradio` + aria-checked */
  checked?: boolean;
  /** visual divider before the item */
  separatorBefore?: boolean;
}

/**
 * Menu button + `role="menu"`. The menu is a `popover="auto"` element (top layer => never clipped by scroll regions,
 * light-dismiss + Esc built in). Arrow keys/Home/End move focus, Tab closes, focus returns to the trigger.
 */
export function DropdownMenu({
  label,
  trigger,
  items,
  align = "end",
  triggerClassName,
  header,
}: {
  /** accessible name of the trigger button */
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  triggerClassName?: string;
  header?: ReactNode;
}) {
  const id = useId();
  const menuId = `m${id}`;
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const place = useCallback(() => {
    const b = btnRef.current;
    const m = menuRef.current;
    if (!b || !m) return;
    const r = b.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let left = align === "end" ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8 && r.top - mh - 4 > 8) top = r.top - mh - 4;
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
  }, [align]);

  function show(focus: "first" | "last" | "none" = "first") {
    const m = menuRef.current;
    if (!m) return;
    try {
      m.showPopover();
    } catch {
      /* already open */
    }
    setOpen(true);
    place();
    const els = enabledItems();
    const target = focus === "last" ? els[els.length - 1] : focus === "first" ? els[0] : null;
    target?.focus();
  }

  function hide() {
    try {
      menuRef.current?.hidePopover();
    } catch {
      /* closed */
    }
  }

  function enabledItems(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
  }

  useEffect(() => {
    if (!open) return;
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, place]);

  function onMenuKey(e: React.KeyboardEvent) {
    const els = enabledItems();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Tab") {
      hide();
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const start = i + 1;
      const ordered = [...els.slice(start), ...els.slice(0, start)];
      ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(ch))?.focus();
    }
  }

  const itemCls = (it: MenuItem) =>
    cn(
      "flex w-full min-h-9 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm pointer-coarse:min-h-11",
      "focus-visible:bg-panel-2 focus-visible:outline-2 focus-visible:-outline-offset-2 hover:bg-panel-2",
      it.danger ? "text-danger" : "text-ink",
      it.disabled && "pointer-events-none opacity-50",
    );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={triggerClassName}
        onClick={() => (open ? hide() : show("first"))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            show("first");
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            show("last");
          }
        }}
      >
        {trigger}
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onMenuKey}
        onToggle={(e) => {
          const isOpen = (e as unknown as { newState: string }).newState === "open";
          setOpen(isOpen);
          if (!isOpen) btnRef.current?.focus({ preventScroll: true });
        }}
        className="fixed m-0 min-w-52 max-w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-edge bg-panel p-1.5 text-ink shadow-pop"
        style={{ inset: "auto" }}
      >
        {header ? <div className="border-b border-edge px-2.5 pb-2 pt-1.5 text-sm">{header}</div> : null}
        {items.map((it) => {
          const content = (
            <>
              {it.icon ? (
                <span aria-hidden className="grid size-4 place-items-center">
                  {it.icon}
                </span>
              ) : null}
              <span className="flex-1">{it.label}</span>
              {it.checked ? (
                <span aria-hidden className="text-brand">
                  ●
                </span>
              ) : null}
            </>
          );
          const common = {
            tabIndex: -1,
            "aria-disabled": it.disabled || undefined,
            className: itemCls(it),
          };
          return (
            <div key={it.id} role="none" className={cn(it.separatorBefore && "mt-1 border-t border-edge pt-1")}>
              {it.href ? (
                it.external ? (
                  <a role="menuitem" href={it.href} target="_blank" rel="noopener noreferrer" onClick={hide} {...common}>
                    {content}
                  </a>
                ) : (
                  <Link role="menuitem" href={it.href} onClick={hide} {...common}>
                    {content}
                  </Link>
                )
              ) : (
                <button
                  type="button"
                  role={it.checked !== undefined ? "menuitemradio" : "menuitem"}
                  aria-checked={it.checked !== undefined ? it.checked : undefined}
                  onClick={() => {
                    hide();
                    it.onSelect?.();
                  }}
                  {...common}
                >
                  {content}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
