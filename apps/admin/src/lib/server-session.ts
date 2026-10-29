import { createApiClient, isApiError, type Me } from "@blog/shared/client";
import { serverApiOptions } from "@blog/shared/server";
import { cookies } from "next/headers";

export type SessionResult =
  | { status: "ok"; me: Me }
  | { status: "anonymous" }
  | { status: "suspended"; message: string };

/**
 * Server-side session check: forwards the incoming cookies to `GET /api/me`. The API stays the real authority
 * (it re-checks the admin role on every `/api/admin/*` route); this only decides what to render/redirect.
 * A down API throws (-> `error.tsx`), it is never mistaken for "signed out".
 */
export async function getSession(): Promise<SessionResult> {
  const cookie = (await cookies()).toString();
  if (!cookie) return { status: "anonymous" };
  // Target = the API_INTERNAL_URL binding (any URL shape), else this deployment's public URL (+ Authentication bypass header).
  const target = serverApiOptions();
  const client = createApiClient({ baseUrl: target.baseUrl, basePath: target.basePath, timeoutMs: target.timeoutMs, headers: { ...target.headers, cookie } });
  try {
    const me = await client.me({ cache: "no-store" });
    return { status: "ok", me };
  } catch (err) {
    if (isApiError(err)) {
      if (err.status === 401) return { status: "anonymous" };
      if (err.status === 403) return { status: "suspended", message: err.message };
    }
    throw err;
  }
}
