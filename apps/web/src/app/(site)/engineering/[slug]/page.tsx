import type { Metadata } from "next";
import { PostPage, sectionStaticParams } from "@/components/blog/post/PostPage";
import { postMetadata } from "@/components/blog/post/post-meta";

export async function generateStaticParams() {
  return sectionStaticParams("engineering");
}

export async function generateMetadata({ params }: PageProps<"/engineering/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return postMetadata("engineering", slug);
}

export default async function Page({ params }: PageProps<"/engineering/[slug]">) {
  const { slug } = await params;
  return <PostPage section="engineering" slug={slug} />;
}
