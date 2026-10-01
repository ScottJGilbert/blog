import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/", "/internal/", "/account", "/login", "/signup", "/reset-password"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
