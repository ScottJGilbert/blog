"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { LuX } from "react-icons/lu";
import { IconButton } from "./button";
import { cn } from "./cn";

let lockCount = 0;
function lockScroll(lock: boolean) {
  lockCount += lock ? 1 : -1;
  document.documentElement.style.overflow = lockCount > 0 ? "hidden" : "";
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Click on the backdrop closes (default true). Set false for forms with unsaved input. */
  dismissOnBackdrop?: boolean;
  /** Render as a side drawer (used by the mobile navigation). */
  drawer?: boolean;
  hideTitle?: boolean;
}

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

/**
 * Modal dialog on the native `<dialog>` element: `showModal()` gives the focus trap, inert background, Esc to close and
 * focus restoration for free. The first element with `data-autofocus` (else the first focusable) gets focus.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissOnBackdrop = true,
  drawer = false,
  hideTitle = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      lockScroll(true);
      const target = el.querySelector<HTMLElement>("[data-autofocus]");
      target?.focus();
      return () => {
        lockScroll(false);
        if (el.open) el.close();
      };
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={() => onCloseRef.current()}
      onCancel={(e) => {
        // Esc: let the browser close the dialog, our onClose handler syncs the state.
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        // `<dialog>` itself is only the target for backdrop clicks (content fills a child box)
        if (dismissOnBackdrop && e.target === ref.current) onCloseRef.current();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-edge bg-panel p-0 text-ink shadow-pop",
        drawer ? "m-0 h-dvh max-h-none w-[min(20rem,88vw)] rounded-none rounded-r-xl border-l-0" : sizes[size],
      )}
    >
      {open ? (
        <div className={cn("flex flex-col", drawer ? "h-full" : "max-h-[calc(100dvh-1.5rem)]")}>
          <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-3.5">
            <div className="min-w-0">
              <h2 id={titleId} className={cn("text-base font-semibold", hideTitle && "sr-only")}>
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton label="Close dialog" size="sm" onClick={() => onCloseRef.current()}>
              <LuX aria-hidden className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-edge bg-panel-2/50 px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
