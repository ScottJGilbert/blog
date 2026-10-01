import { NextResponse, type NextRequest } from "next/server";

/**
 * Route protection (Next 16 `proxy`, formerly `middleware`). This is an optimistic, cookie-PRESENCE check only:
 * it keeps anonymous visitors off the app shell cheaply. The authoritative checks are
 *   1. the server-side layout check (`/api/me`, role === "admin") in `app/(dashboard)/layout.tsx`, and
 *   2. the API itself (requireAdmin on every `/api/admin/*` route).
 * `nextUrl.pathname` excludes the `/admin` basePath; redirects built from `nextUrl.clone()` keep it.
 */
const SESSION_COOKIES = ["blog.session_token", "__Secure-blog.session_token"];

export function proxy(request: NextRequest) {
  const { nextUrl, cookies } = request;
  const hasSession = SESSION_COOKIES.some((name) => Boolean(cookies.get(name)?.value));
  const path = nextUrl.pathname + nextUrl.search;

  if (!hasSession) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (path !== "/" && path.length < 1500) url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Let server components know where we are (layouts cannot read the pathname) for `/login?next=`.
  const headers = new Headers(request.headers);
  headers.set("x-admin-path", path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except the login page, Next internals and files with an extension (icons, etc.).
  matcher: ["/((?!login|_next/static|_next/image|.*\\..*).*)"],
};
