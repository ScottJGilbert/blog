"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { LuX } from "react-icons/lu";

/**
 * Modal dialog on the native <dialog> element: `showModal()` gives a real focus trap, inert background, Esc to close
 * and focus restoration to the opener, with no JS focus-trap code to get wrong. Controlled via `open`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(event) => {
        // Click on the backdrop (the dialog element itself, outside its padded content box).
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-border-strong bg-surface p-0 text-fg shadow-card-hover backdrop:bg-black/50"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg hover:bg-surface-2"
            >
              <LuX aria-hidden className="size-5" />
            </button>
          </div>
          {description && (
            <p id={descId} className="mt-1 text-muted">
              {description}
            </p>
          )}
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
