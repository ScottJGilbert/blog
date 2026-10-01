import { permanentRedirect } from "next/navigation";
import { parseTag } from "@/lib/paths";

/** /tags/<slug> is a permanent alias of the section-agnostic tag listing at /search?tag=<slug>. */
export default async function TagRedirect({ params }: PageProps<"/tags/[tag]">) {
  const { tag } = await params;
  const slug = parseTag(decodeURIComponent(tag));
  permanentRedirect(slug ? `/search?tag=${encodeURIComponent(slug)}` : "/search");
}
