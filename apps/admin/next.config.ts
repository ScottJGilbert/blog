import path from "node:path";
import type { NextConfig } from "next";

/**
 * Admin app. Lives under `/admin` (see docs/SPEC.md §1/§3): in production the platform routes `/admin` to this
 * service; locally it also works standalone (e.g. http://localhost:3001/admin).
 * `/api/*` is proxied to the API service so the browser (cookies, CSRF Origin check) always talks to ONE origin.
 *
 * NOTE: `rewrites()` is evaluated at build time. Set API_INTERNAL_URL when running `next build`.
 */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  basePath: "/admin",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@blog/shared", "@blog/content"],
  // Webpack (not Turbopack) because Turbopack cannot run loaders over CSS; see build-tools/strip-remote-css-imports.cjs.
  webpack(config) {
    config.module.rules.unshift({
      // (no `test: /\.css$/`: Next disables its built-in CSS support when it sees a custom CSS rule)
      include: /lexical-blog-editor[\\/]build[\\/].*\.css$/,
      enforce: "pre",
      use: [{ loader: path.join(process.cwd(), "build-tools/strip-remote-css-imports.cjs") }],
    });
    return config;
  },
  async rewrites() {
    return [
      // `basePath: false` => matches `/api/...` (not `/admin/api/...`); the API owns the whole `/api` prefix.
      { source: "/api/:path*", destination: `${API_INTERNAL_URL}/api/:path*`, basePath: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Authenticated HTML must never be cached by a shared cache / bfcache-restored after sign-out.
        source: "/((?!_next/static|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
