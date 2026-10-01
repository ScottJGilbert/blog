import type { Metadata } from "next";
import { emptyContent } from "@blog/content";
import type { LexicalContent } from "@blog/shared";
import { PostEditor } from "@/features/posts/post-editor";

export const metadata: Metadata = { title: "New post" };

export default function NewPostPage() {
  // Computed on the server so `@blog/content` never ships in the client bundle. Without an explicit initial state the
  // editor package would pre-fill a "Welcome to the rich blog editor" heading.
  const emptyDoc = JSON.parse(JSON.stringify(emptyContent())) as LexicalContent;
  return <PostEditor emptyDoc={emptyDoc} />;
}
