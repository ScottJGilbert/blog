import type { Metadata } from "next";
import { listingMetadata, SectionListing } from "@/components/blog/SectionListing";
import { parsePage, parseTag } from "@/lib/paths";

export async function generateMetadata({ searchParams }: PageProps<"/personal">): Promise<Metadata> {
  const sp = await searchParams;
  return listingMetadata("personal", parsePage(sp.page), parseTag(sp.tag));
}

export default async function PersonalPage({ searchParams }: PageProps<"/personal">) {
  const sp = await searchParams;
  return <SectionListing section="personal" page={parsePage(sp.page)} tag={parseTag(sp.tag)} />;
}
