"use client";

import { useState } from "react";
import { LuCheck, LuLink, LuShare2 } from "react-icons/lu";
import { Button } from "@/components/ui/Button";

/** Copy-link + native share (falls back to copying where the Web Share API is missing). */
export function ShareBar({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API blocked (insecure context / permissions): select-and-copy fallback.
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, title });
        return;
      } catch (err) {
        if ((err as DOMException).name === "AbortError") return;
      }
    }
    await copy();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={copy}>
        {copied ? <LuCheck aria-hidden className="size-4" /> : <LuLink aria-hidden className="size-4" />}
        Copy link
      </Button>
      <Button variant="secondary" onClick={share}>
        <LuShare2 aria-hidden className="size-4" />
        Share
      </Button>
      <span role="status" aria-live="polite" className="min-w-24 text-sm font-semibold text-muted">
        {copied ? "Link copied" : ""}
      </span>
    </div>
  );
}
