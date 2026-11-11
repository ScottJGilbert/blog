import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that apply to using this blog, its comments and its newsletter.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PageContainer size="prose" className="py-12 sm:py-16">
      <SectionHeader eyebrow="Legal" title="Terms of Service" description="Last updated November 3, 2026." />
      <div className="mt-10 space-y-5 text-lg leading-8 text-muted">
        <h2 className="pt-4 text-2xl text-fg">Using this site</h2>
        <p>By using this site you agree to these terms. If you do not agree, please do not use it. The site is a personal blog by Scott Gilbert.</p>
        <h2 className="pt-4 text-2xl text-fg">Accounts</h2>
        <p>You need an account to comment or subscribe to the newsletter. Keep your password secure and give accurate information. You are responsible for activity on your account, and you can delete it at any time from your account page.</p>
        <h2 className="pt-4 text-2xl text-fg">Comments and conduct</h2>
        <p>You own what you write, and you give this site permission to display it. Do not post anything unlawful, abusive, spammy or that infringes others&rsquo; rights. Comments may be moderated or removed, and accounts that break these rules may be suspended.</p>
        <h2 className="pt-4 text-2xl text-fg">Content</h2>
        <p>Posts and other content are copyrighted by Scott Gilbert unless stated otherwise. You may quote short excerpts with a link back. Posts are shared for information only and come without warranties.</p>
        <h2 className="pt-4 text-2xl text-fg">Newsletter</h2>
        <p>Subscribing sends you an email when a new post is published. You can unsubscribe at any time using the link in every email or from your account page.</p>
        <h2 className="pt-4 text-2xl text-fg">Liability</h2>
        <p>The site is provided as is, without warranties. To the extent the law allows, Scott Gilbert is not liable for losses arising from use of the site.</p>
        <h2 className="pt-4 text-2xl text-fg">Changes and contact</h2>
        <p>These terms may change; continued use means you accept the updated terms. Questions can be sent through the contact details on the About page.</p>
      </div>
    </PageContainer>
  );
}
