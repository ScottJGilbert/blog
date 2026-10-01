"use client";

import { createApiClient } from "@blog/shared/client";

/** Same-origin API client for browser code (cookie session via `credentials: "include"`). */
export const browserApi = createApiClient({ baseUrl: "", timeoutMs: 15_000 });
