"use client";

import dynamic from "next/dynamic";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { Button } from "@/components/ui/button";
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

const LazyEditor = dynamic<RichEditorProps>(() => import("./editor-impl"), {
  ssr: false,
  loading: () => <EditorLoading />,
});

/**
 * Lexical throws while parsing content it cannot represent. Without this boundary that error reaches the app-level
 * boundary ("The admin could not load. If the API is not running…"), which is wrong and hides the rest of the form.
 * Here only the editor panel is replaced; the stored content is never touched (the editor reports nothing, so the
 * form keeps the content it loaded) and the other fields stay editable.
 */
class EditorBoundary extends Component<{ children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Editor failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex min-h-[12rem] flex-col items-start gap-3 p-5">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <LuTriangleAlert aria-hidden className="size-5" />
            The editor could not open this content
          </p>
          <p className="max-w-prose text-sm text-muted">
            The stored content has not been changed. You can still edit the other fields and save them; the body is kept exactly as it is. Reload
            the page to try again.
          </p>
          <Button onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>Try again</Button>
        </div>
      );
    }
    return <div key={this.state.attempt}>{this.props.children}</div>;
  }
}

export function RichEditor(props: RichEditorProps) {
  return (
    <EditorBoundary>
      <LazyEditor {...props} />
    </EditorBoundary>
  );
}
