import type { Metadata } from "next";
import { Suspense } from "react";
import { NewslettersView } from "@/features/newsletters/newsletters-view";

export const metadata: Metadata = { title: "Newsletters" };

export default function Page() {
  return (
    <Suspense>
      <NewslettersView />
    </Suspense>
  );
}
