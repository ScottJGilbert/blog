import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// B3: extend with published posts fetched from the API.
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/personal", "/engineering", "/about"].map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
  }));
}
