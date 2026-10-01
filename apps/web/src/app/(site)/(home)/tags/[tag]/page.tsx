import { permanentRedirect } from "next/navigation";
import { parseTag } from "@/lib/paths";

/** /tags/<slug> is a permanent alias of the section-agnostic tag listing at /search?tag=<slug>. */
export default async function TagRedirect({ params }: PageProps<"/tags/[tag]">) {
  const { tag } = await params;
  // A malformed escape (`/tags/%E0%A4%A`) must not turn into a 500.
  let decoded = tag;
  try {
    decoded = decodeURIComponent(tag);
  } catch {
    /* keep the raw value: parseTag rejects it */
  }
  const slug = parseTag(decoded);
  permanentRedirect(slug ? `/search?tag=${encodeURIComponent(slug)}` : "/search");
}
