import type { Metadata } from "next";
import { listingMetadata } from "@/components/blog/SectionListing";
import { CookbookListing } from "@/components/cookbook/CookbookListing";
import { parsePage, parseTag } from "@/lib/paths";

export async function generateMetadata({ searchParams }: PageProps<"/cookbook">): Promise<Metadata> {
  const sp = await searchParams;
  return listingMetadata("cookbook", parsePage(sp.page), parseTag(sp.tag));
}

export default async function CookbookPage({ searchParams }: PageProps<"/cookbook">) {
  const sp = await searchParams;
  return <CookbookListing page={parsePage(sp.page)} tag={parseTag(sp.tag)} />;
}
