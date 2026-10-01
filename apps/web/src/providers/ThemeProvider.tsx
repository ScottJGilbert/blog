"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme-script";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  /** The stored preference. `system` follows the OS. */
  theme: Theme;
  /** What is actually rendered right now. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_EVENT = "blog-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isTheme = (value: string | null): value is Theme =>
  value === "light" || value === "dark" || value === "system";

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function subscribeTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

function subscribeSystem(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * SSR-safe theme state. The server (and the hydration pass) always sees
 * `system`/light; the real value is read from localStorage on the client
 * through useSyncExternalStore, so hydration never mismatches. The visual
 * theme itself is applied before paint by `themeInitScript`, not by React.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore<Theme>(
    subscribeTheme,
    readStoredTheme,
    () => "system",
  );
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const resolvedTheme: ResolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Follow OS changes while the preference is `system`, and theme changes made
  // in another tab. (Never applied on mount: the init script already did, and a
  // pre-hydration snapshot must not undo it.)
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const sync = () => {
      const stored = readStoredTheme();
      applyTheme(stored === "system" ? query.matches : stored === "dark");
    };
    query.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      query.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
    applyTheme(
      next === "system"
        ? window.matchMedia(DARK_QUERY).matches
        : next === "dark",
    );
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
