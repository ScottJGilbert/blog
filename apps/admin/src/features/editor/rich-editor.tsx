"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { RichEditorProps } from "./editor-impl";

/** Fixed-height placeholder (same min-height as the editor) => no layout shift while Lexical loads. */
function EditorLoading() {
  return (
    <div role="status" aria-busy="true" className="min-h-[34rem] space-y-3 p-4">
      <span className="sr-only">Loading editor…</span>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-5 w-5/6" />
      <Skeleton className="h-5 w-4/6" />
      <Skeleton className="h-5 w-3/6" />
    </div>
  );
}

export const RichEditor = dynamic<RichEditorProps>(() => import("./editor-impl"), {
  ssr: false,
  loading: () => <EditorLoading />,
});
