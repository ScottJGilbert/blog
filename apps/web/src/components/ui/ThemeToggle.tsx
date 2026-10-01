"use client";

import { LuMoon, LuSun } from "react-icons/lu";
import { clsx } from "clsx";
import { useTheme } from "@/providers/ThemeProvider";

/**
 * Light/dark switch. Both icons are always rendered and swapped with CSS
 * (`dark:` variant) so the button is identical on the server, during hydration
 * and after, with a fixed 44x44 box (no layout shift, no empty placeholder).
 * The accessible name is static; state is exposed through aria-pressed.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Dark mode"
      aria-pressed={isDark}
      className={clsx(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg transition-colors hover:bg-surface-2",
        className,
      )}
    >
      <LuSun aria-hidden className="hidden size-5 dark:block" />
      <LuMoon aria-hidden className="block size-5 dark:hidden" />
    </button>
  );
}
