import type { Metadata } from "next";
import { Suspense } from "react";
import { UsersView } from "@/features/users/users-view";

export const metadata: Metadata = { title: "Users" };

export default function Page() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}
