"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}

type Confirm = (opts: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Confirm | null>(null);

/** `const confirm = useConfirm(); if (await confirm({ title: "Delete?", tone: "danger" })) …` */
export function useConfirm(): Confirm {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return c;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((o) => {
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  function settle(v: boolean) {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }

  const value = useMemo(() => confirm, [confirm]);
  const tone = opts?.tone ?? "primary";
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog
        open={opts !== null}
        onClose={() => settle(false)}
        title={opts?.title ?? ""}
        description={opts?.description}
        size="sm"
        footer={
          <>
            <Button data-autofocus onClick={() => settle(false)}>
              {opts?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={tone === "danger" ? "danger" : "primary"} onClick={() => settle(true)}>
              {opts?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      />
    </Ctx.Provider>
  );
}
