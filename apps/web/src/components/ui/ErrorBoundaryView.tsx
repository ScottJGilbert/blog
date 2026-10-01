"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

/** Shared body for error.tsx files. Inherits the theme of the segment it is in. */
export function ErrorBoundaryView({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusPage
      title="Something went wrong"
      description="An unexpected error occurred. You can try again, or head back to the home page."
    >
      <Button size="lg" onClick={retry}>
        Try again
      </Button>
      <ButtonLink href="/" variant="secondary" size="lg">
        Back to home
      </ButtonLink>
    </StatusPage>
  );
}
