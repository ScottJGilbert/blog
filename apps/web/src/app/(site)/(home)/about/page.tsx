import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";

export const metadata: Metadata = {
  title: "About",
  description:
    "About Scott Gilbert, a computer engineer who writes about engineering, making and meaningful human impact.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PageContainer size="prose" className="py-12 sm:py-16">
      <SectionHeader
        eyebrow="About"
        title="About the author"
        description="This blog is maintained by Scott, a computer engineer passionate about technology and about making miracles happen at the same time."
      />
      <div className="mt-10 space-y-5 text-lg leading-8 text-muted">
        <p>
          More information about the author and the mission of this blog is
          coming soon. In the meantime, browse the{" "}
          <Link
            href="/personal"
            className="font-semibold text-accent underline underline-offset-4"
          >
            personal
          </Link>{" "}
          and{" "}
          <Link
            href="/engineering"
            className="font-semibold text-accent underline underline-offset-4"
          >
            engineering
          </Link>{" "}
          sections.
        </p>
      </div>
    </PageContainer>
  );
}
