"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markSignedIn } from "@/lib/auth-store";

/** Landing page of OAuth / email-verification callbacks: sync the header state, then continue to `next`. */
export function AuthComplete({ next }: { next: string }) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    void markSignedIn().then(() => {
      if (alive) router.replace(next);
    });
    return () => {
      alive = false;
    };
  }, [next, router]);
  return (
    <p role="status" className="text-muted">
      Signing you in…
    </p>
  );
}
