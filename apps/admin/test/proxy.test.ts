import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "../src/proxy";

const req = (cookie?: string) =>
  new NextRequest("https://blog.example.org/admin/posts", { headers: cookie ? { cookie } : {} });

describe("admin proxy (cookie-presence gate)", () => {
  it("redirects anonymous visitors to the login page, keeping the destination", () => {
    const res = proxy(req());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  // Better Auth prefixes the cookie with `__Secure-` whenever useSecureCookies is on (always in production, so on Vercel)
  it.each(["blog.session_token=abc", "__Secure-blog.session_token=abc"])("lets a request with %s through", (cookie) => {
    const res = proxy(req(cookie));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("ignores unrelated or empty cookies", () => {
    expect(proxy(req("other=1; blog.session_token=")).status).toBe(307);
    expect(proxy(req("better-auth.session_token=abc")).status).toBe(307);
  });

  it("does not run for static assets or the login page", () => {
    const matcher = new RegExp(`^${config.matcher[0]!}$`);
    for (const p of ["/", "/posts", "/posts/123", "/settings"]) expect(matcher.test(p), p).toBe(true);
    for (const p of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/login", "/robots.txt"]) expect(matcher.test(p), p).toBe(false);
  });
});
