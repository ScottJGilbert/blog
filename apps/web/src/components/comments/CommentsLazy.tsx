"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

/** Section frame with the same id/heading/reserved height as the real thing, so swapping it in shifts nothing. */
const RESERVED = "min-h-[28rem]";

const Comments = dynamic(() => import("./Comments").then((m) => m.Comments), {
  ssr: false,
  loading: () => <Frame />,
});

function Frame({ innerRef }: { innerRef?: React.Ref<HTMLElement> }) {
  return (
    <section ref={innerRef} id="comments" aria-labelledby="comments-title" className={RESERVED}>
      <h2 id="comments-title" className="text-2xl">
        Comments
      </h2>
      <div aria-hidden className="mt-5 min-h-44 rounded-card border border-border bg-surface p-4 sm:p-5">
        <div className="grid gap-3">
          <div className="h-5 w-32 rounded bg-surface-2 motion-safe:animate-pulse" />
          <div className="h-24 rounded-control bg-surface-2 motion-safe:animate-pulse" />
        </div>
      </div>
    </section>
  );
}

/**
 * The comments code (and its network traffic) is only loaded when the section is within ~600px of the viewport, or
 * when the URL points at it (#comments / #comment-<id>). Keeps ~15 KB of JavaScript off the initial page load.
 */
export function CommentsLazy({ slug }: { slug: string }) {
  const ref = useRef<HTMLElement>(null);
  const [load, setLoad] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || load) return;
    if (location.hash.startsWith("#comment") || typeof IntersectionObserver === "undefined") {
      const t = window.setTimeout(() => setLoad(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLoad(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  return load ? <Comments slug={slug} /> : <Frame innerRef={ref} />;
}
