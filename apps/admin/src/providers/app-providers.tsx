"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "./theme-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <SWRConfig
        value={{
          revalidateOnFocus: false,
          shouldRetryOnError: false,
          dedupingInterval: 1500,
          keepPreviousData: true,
        }}
      >
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
