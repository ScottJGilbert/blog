import type { Metadata } from "next";
import { AccountView } from "@/components/auth/AccountView";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";

export const metadata: Metadata = {
  title: "Your account",
  alternates: { canonical: "/account" },
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <div className="section-motif">
      <PageContainer size="prose" className="py-12 sm:py-16">
        <SectionHeader eyebrow="Account" title="Your account" description="Manage your profile, newsletter and sign-in." />
        <div className="mt-10">
          <AccountView />
        </div>
      </PageContainer>
    </div>
  );
}
