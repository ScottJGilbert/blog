"use client";

import type { ApiClient } from "@blog/shared/client";

let client: Promise<ApiClient> | undefined;

/**
 * Same-origin API client for browser code (cookie session via `credentials: "include"`). Loaded lazily: the shared
 * client bundles zod, so it is fetched only when an island actually needs the network (sign-in lookup, newsletter
 * submit, comments, account), never as part of a page's initial JavaScript.
 */
export function getBrowserApi(): Promise<ApiClient> {
  client ??= import("@blog/shared/client").then((m) => m.createApiClient({ baseUrl: "", timeoutMs: 15_000 }));
  return client;
}
