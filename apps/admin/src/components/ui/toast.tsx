"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LuCircleAlert, LuCircleCheck, LuInfo, LuX } from "react-icons/lu";
import { cn } from "./cn";

type Kind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}

const icons = { success: LuCircleCheck, error: LuCircleAlert, info: LuInfo };
const accent = { success: "text-ok", error: "text-danger", info: "text-info" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { id, kind, message }]);
      // Always-mounted live regions announce reliably (toggle text to re-announce identical messages).
      if (kind === "error") setAssertive((m) => (m === message ? message + " " : message));
      else setPolite((m) => (m === message ? message + " " : message));
      window.setTimeout(() => dismiss(id), kind === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push("success", m), error: (m) => push("error", m), info: (m) => push("info", m) }),
    [push],
  );

  // Show the stack in the top layer so it stays visible above open modal dialogs.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (items.length > 0) {
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } else if (el.matches(":popover-open")) {
        el.hidePopover();
      }
    } catch {
      /* popover unsupported: falls back to normal fixed positioning below */
    }
  }, [items]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      <div
        ref={listRef}
        popover="manual"
        aria-label="Notifications"
        role="region"
        className="fixed inset-auto bottom-4 left-auto right-4 m-0 w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 overflow-visible border-0 bg-transparent p-0 max-sm:inset-x-4 max-sm:w-auto [&:popover-open]:flex"
      >
        {items.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div
              key={t.id}
              className="flex items-start gap-3 rounded-xl border border-edge bg-panel px-3.5 py-3 text-sm text-ink shadow-pop"
            >
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", accent[t.kind])} />
              <p className="min-w-0 flex-1 break-words">{t.message}</p>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(t.id)}
                className="-m-1 grid size-8 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-ink pointer-coarse:size-11"
              >
                <LuX aria-hidden className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
