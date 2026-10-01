import { api } from "@/lib/api";
import { parseSection } from "@/lib/paths";

/**
 * /feed.xml?section=engineering: RSS 2.0 proxied from the API (`/api/feed.xml`) over the internal URL. In production
 * `/api/*` is routed to the API service, `/feed.xml` is a web route that fetches from `API_INTERNAL_URL`, so feed
 * readers get a stable URL on the site's own domain. Cached with the `posts` tag (invalidated on publish).
 */
export const revalidate = 600;

export async function GET(request: Request) {
  const section = parseSection(new URL(request.url).searchParams.get("section") ?? undefined);
  const url = api.feedUrl(section); // origin = API_INTERNAL_URL
  try {
    const upstream = await fetch(url, {
      headers: { accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 600, tags: section ? ["posts", `section:${section}`] : ["posts"] },
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const xml = await upstream.text();
    return new Response(xml, {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "public, s-maxage=600, stale-while-revalidate=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("The feed is temporarily unavailable.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "60" },
    });
  }
}
