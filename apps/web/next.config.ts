import type { NextConfig } from "next";
import { MEDIA_HOSTS } from "./src/lib/media-hosts";

const isProd = process.env.NODE_ENV === "production";

/** Dev topology (SPEC §3): emulate the single-origin production routing. Never in production unless DEV_PROXY=1. */
const proxyEnabled = !isProd || process.env.DEV_PROXY === "1";
const apiOrigin = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/+$/, "").replace(/\/api$/, "");
const adminOrigin = (process.env.ADMIN_DEV_URL ?? "http://localhost:3001").replace(/\/+$/, "").replace(/\/admin$/, "");

/**
 * Content-Security-Policy. Static/ISR pages cannot carry per-request nonces, so inline scripts (the theme bootstrap and
 * Next's own flight/bootstrap scripts) need 'unsafe-inline'; everything else is locked down. Embeds in post content are
 * limited to the hosts @blog/content is allowed to emit (YouTube nocookie, Figma, X/Twitter).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com${isProd ? "" : " ws: wss:"}`,
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.figma.com https://platform.twitter.com",
  "media-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@blog/shared", "@blog/content"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: MEDIA_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname })),
  },
  async rewrites() {
    if (!proxyEnabled) return [];
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/admin/:path*", destination: `${adminOrigin}/admin/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
