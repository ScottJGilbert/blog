"use client";

import { createApiClient } from "@blog/shared/client";
import { BASE_PATH } from "./base-path";
import { loginUrl } from "./safe-next";

let redirecting = false;

/** A 401 from any API call means the session ended (expired, revoked, banned) -> go to the login screen. */
export function handleUnauthorized(): void {
  if (typeof window === "undefined" || redirecting) return;
  redirecting = true;
  const here = window.location.pathname.startsWith(BASE_PATH)
    ? window.location.pathname.slice(BASE_PATH.length) + window.location.search
    : "/";
  window.location.assign(`${BASE_PATH}${loginUrl(here || "/", { expired: "1" })}`);
}

const apiFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 401) handleUnauthorized();
  return res;
};

/** Typed client for the browser. Same-origin (`/api/...` is rewritten to the API service). */
export const api = createApiClient({ baseUrl: "", fetch: apiFetch, timeoutMs: 30_000 });
