import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthComplete } from "@/components/auth/AuthComplete";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Signing in", robots: { index: false, follow: false } };

export default async function AuthCompletePage({ searchParams }: PageProps<"/auth/complete">) {
  const sp = await searchParams;
  return (
    <AuthCard title="Signing you in">
      <AuthComplete next={safeNext(sp.next)} />
    </AuthCard>
  );
}
