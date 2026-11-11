import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data this blog collects, why, and how you can control it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PageContainer size="prose" className="py-12 sm:py-16">
      <SectionHeader eyebrow="Legal" title="Privacy Policy" description="Last updated November 3, 2026." />
      <div className="mt-10 space-y-5 text-lg leading-8 text-muted">
        <h2 className="pt-4 text-2xl text-fg">What we collect</h2>
        <p>When you create an account we store your name, email address and a securely hashed password (or the profile details from the social sign-in you choose). If you comment, we store your comments. If you subscribe, we store your email address and subscription status.</p>
        <h2 className="pt-4 text-2xl text-fg">How we use it</h2>
        <p>To run your account, show your comments, send the newsletter you asked for, send account emails such as verification and password reset, and keep the site secure. We do not sell your data or use it for advertising.</p>
        <h2 className="pt-4 text-2xl text-fg">Service providers</h2>
        <p>We use infrastructure and email providers to host the site and deliver email. They process data only to provide those services.</p>
        <h2 className="pt-4 text-2xl text-fg">Cookies</h2>
        <p>We use essential cookies to keep you signed in and to remember preferences such as your theme and cookie choice.</p>
        <h2 className="pt-4 text-2xl text-fg">Your choices</h2>
        <p>You can unsubscribe at any time, and you can view, change or delete your account and its data from your account page. To ask about anything else, use the contact details on the About page.</p>
        <h2 className="pt-4 text-2xl text-fg">Retention and changes</h2>
        <p>We keep your data while your account exists and delete it when you delete your account, except where the law requires otherwise. This policy may change; the date above shows the latest update.</p>
      </div>
    </PageContainer>
  );
}
