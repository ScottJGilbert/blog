import type { Metadata } from "next";
import { Suspense } from "react";
import { SubscribersView } from "@/features/subscribers/subscribers-view";

export const metadata: Metadata = { title: "Subscribers" };

export default function Page() {
  return (
    <Suspense>
      <SubscribersView />
    </Suspense>
  );
}
