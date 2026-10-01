import type { Metadata } from "next";
import { PostEditor } from "@/features/posts/post-editor";

export const metadata: Metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostEditor postId={id} />;
}
