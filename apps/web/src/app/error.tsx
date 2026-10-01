"use client";

import { SiteShell } from "@/components/layout/SiteShell";
import { ErrorBoundaryView } from "@/components/ui/ErrorBoundaryView";

// Last-resort boundary (replaces the section layout, so it brings its own shell).
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <SiteShell section="home">
      <ErrorBoundaryView error={error} retry={unstable_retry} />
    </SiteShell>
  );
}
