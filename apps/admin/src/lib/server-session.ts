import { createApiClient, isApiError, type Me } from "@blog/shared/client";
import { cookies } from "next/headers";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

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
  const client = createApiClient({ baseUrl: API_INTERNAL_URL, headers: { cookie }, timeoutMs: 8000 });
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
