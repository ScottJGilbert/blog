"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BASE_PATH } from "./base-path";

/**
 * Warns before the user loses unsaved work:
 *  - closing/reloading the tab or leaving the origin: the browser's native `beforeunload` prompt;
 *  - in-app navigation: clicks on any same-origin link are intercepted (capture phase, so it also covers the sidebar,
 *    breadcrumbs and `next/link`) and routed through an accessible confirm dialog.
 * (The browser Back button inside the SPA cannot be intercepted reliably; drafts are protected by autosave +
 * a flush on unmount instead.)
 */
export function useUnsavedGuard(dirty: boolean, opts: { what?: string; flush?: () => Promise<boolean> } = {}) {
  const what = opts.what ?? "this page";
  const flushRef = useRef(opts.flush);
  useEffect(() => {
    flushRef.current = opts.flush;
  });
  const router = useRouter();
  const confirm = useConfirm();

  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // beforeunload covers leaving the origin
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      const go = () => {
        if (url.pathname === BASE_PATH || url.pathname.startsWith(`${BASE_PATH}/`)) {
          router.push(`${url.pathname.slice(BASE_PATH.length) || "/"}${url.search}${url.hash}`);
        } else {
          // Another service on the same origin (public site): full navigation, native prompt suppressed.
          window.removeEventListener("beforeunload", onBeforeUnload);
          window.location.assign(url.href);
        }
      };
      // Drafts autosave: try to flush first and only ask when that fails.
      const flush = flushRef.current;
      void (flush ? flush().catch(() => false) : Promise.resolve(false)).then((saved) => {
        if (saved) return go();
        return confirm({
          title: "Leave without saving?",
          description: `You have unsaved changes on ${what}. If you leave now they will be lost.`,
          confirmLabel: "Leave page",
          cancelLabel: "Keep editing",
          tone: "danger",
        }).then((ok) => {
          if (ok) go();
        });
      });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, confirm, router, what]);
}
