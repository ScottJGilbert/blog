"use client";

import { ErrorBoundaryView } from "@/components/ui/ErrorBoundaryView";

// Rendered inside the section layout, so header/footer and theme stay in place.
export default function SectionError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorBoundaryView error={error} retry={unstable_retry} />;
}
