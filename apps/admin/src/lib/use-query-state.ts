"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** URL-backed list state (`?status=draft&page=2`): shareable, survives reload, Back-button friendly. */
export function useQueryState<K extends string>(keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const values = {} as Record<K, string>;
  for (const k of keys) values[k] = sp.get(k) ?? "";

  const set = useCallback(
    (patch: Partial<Record<K | "page", string | number | null>>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch) as [string, string | number | null][]) {
        if (v === null || v === "" || v === undefined) next.delete(k);
        else next.set(k, String(v));
      }
      if (opts.resetPage && !("page" in patch)) next.delete("page");
      if (next.get("page") === "1") next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, sp],
  );

  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  return { values, page, set };
}

/** Text input state that is debounced into the URL (`q`). */
export function useDebouncedQuery(urlValue: string, commit: (v: string) => void, delay = 300) {
  const [text, setText] = useState(urlValue);
  const last = useRef(urlValue);

  useEffect(() => {
    // URL changed from outside (Back button, "clear filters")
    if (urlValue !== last.current) {
      last.current = urlValue;
      const t = window.setTimeout(() => setText(urlValue), 0);
      return () => window.clearTimeout(t);
    }
  }, [urlValue]);

  useEffect(() => {
    if (text === last.current) return;
    const t = window.setTimeout(() => {
      last.current = text;
      commit(text.trim());
    }, delay);
    return () => window.clearTimeout(t);
  }, [text, delay, commit]);

  return [text, setText] as const;
}
