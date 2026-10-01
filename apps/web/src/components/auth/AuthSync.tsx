"use client";

import { useEffect } from "react";
import { markSignedIn } from "@/lib/auth-store";

/** Renders nothing: refreshes the session store (e.g. after email verification auto-signs the user in). */
export function AuthSync() {
  useEffect(() => {
    void markSignedIn();
  }, []);
  return null;
}
