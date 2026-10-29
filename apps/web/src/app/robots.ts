import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// Evaluated per request: the site origin comes from the runtime environment (a preview's URL is not known at build time).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/", "/internal/", "/account", "/signup", "/reset-password", "/verify-email", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
