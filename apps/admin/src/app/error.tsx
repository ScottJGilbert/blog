"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div role="alert" className="max-w-md rounded-xl border border-edge bg-panel p-6 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          The admin could not load. If the API is not running, start it and try again.
          {error.digest ? <span className="mt-1 block font-mono text-xs">Ref: {error.digest}</span> : null}
        </p>
        <Button variant="primary" className="mt-4" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
