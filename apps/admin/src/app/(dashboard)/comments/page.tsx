import type { Metadata } from "next";
import { Suspense } from "react";
import { CommentsView } from "@/features/comments/comments-view";

export const metadata: Metadata = { title: "Comments" };

export default function CommentsPage() {
  return (
    <Suspense>
      <CommentsView />
    </Suspense>
  );
}
