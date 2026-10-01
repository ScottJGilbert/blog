"use client";

import { createAuthClient } from "better-auth/client";

/** Better Auth client; `/api/auth/*` is same-origin through the Next rewrite. */
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost",
});
