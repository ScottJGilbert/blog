import type { Metadata } from "next";
import { listingMetadata, SectionListing } from "@/components/blog/SectionListing";
import { parsePage, parseTag } from "@/lib/paths";

export async function generateMetadata({ searchParams }: PageProps<"/engineering">): Promise<Metadata> {
  const sp = await searchParams;
  return listingMetadata("engineering", parsePage(sp.page), parseTag(sp.tag));
}

export default async function EngineeringPage({ searchParams }: PageProps<"/engineering">) {
  const sp = await searchParams;
  return <SectionListing section="engineering" page={parsePage(sp.page)} tag={parseTag(sp.tag)} />;
}
