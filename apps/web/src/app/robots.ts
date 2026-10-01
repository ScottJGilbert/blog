import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

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
