"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme-script";

interface ThemeCtx {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (p: ThemePreference) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
    window.removeEventListener("storage", cb);
  };
}

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePreference) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as ThemePreference);
  const systemDark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const resolved: "light" | "dark" = preference === "dark" || (preference === "system" && systemDark) ? "dark" : "light";

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      if (p === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      /* storage unavailable: the choice applies for this page view only */
    }
    apply(p);
    listeners.forEach((l) => l());
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used inside <ThemeProvider>");
  return c;
}
