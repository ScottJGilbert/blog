import type { MetadataRoute } from "next";
import { unstable_rethrow } from "next/navigation";
import { getSitemap } from "@/lib/api";
import { postHref } from "@/lib/paths";
import { SITE_URL } from "@/lib/site-url";

// Rebuilt at most every 10 minutes and whenever the `posts` tag is revalidated.
export const revalidate = 600;

const STATIC_ROUTES = ["/", "/personal", "/engineering", "/about"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
  }));
  try {
    for (const post of await getSitemap()) {
      entries.push({ url: `${SITE_URL}${postHref(post.section, post.slug)}`, lastModified: new Date(post.updatedAt) });
    }
  } catch (err) {
    unstable_rethrow(err); // build time without an API: let Next render this route per request instead of baking a post-less sitemap
    // API unreachable at runtime: serve the static routes only; the next revalidation adds the posts.
  }
  return entries;
}
