import type { Metadata } from "next";
import { PostPage, sectionStaticParams } from "@/components/blog/post/PostPage";
import { postMetadata } from "@/components/blog/post/post-meta";

export async function generateStaticParams() {
  return sectionStaticParams("cookbook");
}

export async function generateMetadata({ params }: PageProps<"/cookbook/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return postMetadata("cookbook", slug);
}

export default async function Page({ params }: PageProps<"/cookbook/[slug]">) {
  const { slug } = await params;
  return <PostPage section="cookbook" slug={slug} />;
}
