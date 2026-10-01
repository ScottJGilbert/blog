import type { Metadata } from "next";
import { Suspense } from "react";
import { MediaView } from "@/features/media/media-view";

export const metadata: Metadata = { title: "Media" };

export default function MediaPage() {
  return (
    <Suspense>
      <MediaView />
    </Suspense>
  );
}
