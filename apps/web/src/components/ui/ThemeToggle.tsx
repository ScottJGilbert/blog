"use client";

import { useSyncExternalStore } from "react";
import { FaMoon as Moon } from "react-icons/fa";
import { IoIosSunny as Sun } from "react-icons/io";
import { useTheme } from "@/providers/ThemeProvider";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const isDark = resolvedTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const label = mounted ? `Switch to ${nextTheme} mode` : "Toggle theme";

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      className={`inline-flex items-center justify-center rounded-full border border-outline-ghost bg-surface-container p-2 text-foreground/80 backdrop-blur transition-colors hover:bg-surface-alt/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`.trim()}
      aria-label={label}
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" aria-hidden suppressHydrationWarning />
        ) : (
          <Moon className="size-4" aria-hidden suppressHydrationWarning />
        )
      ) : (
        <span className="size-4" aria-hidden />
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}
