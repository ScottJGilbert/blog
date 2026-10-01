import type { Metadata } from "next";
import { PostPage, sectionStaticParams } from "@/components/blog/post/PostPage";
import { postMetadata } from "@/components/blog/post/post-meta";

export async function generateStaticParams() {
  return sectionStaticParams("personal");
}

export async function generateMetadata({ params }: PageProps<"/personal/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return postMetadata("personal", slug);
}

export default async function Page({ params }: PageProps<"/personal/[slug]">) {
  const { slug } = await params;
  return <PostPage section="personal" slug={slug} />;
}
