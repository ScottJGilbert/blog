import type { Metadata } from "next";
import { LuPenLine } from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "Personal",
  description:
    "Life updates, reflections, and what I’m learning beyond the screen.",
  alternates: { canonical: "/personal" },
};

export default function PersonalPage() {
  return (
    <>
      <div className="section-motif">
        <PageContainer className="pt-12 pb-10 sm:pt-16">
          <SectionHeader
            eyebrow="Reflections"
            title="Personal"
            description="Life updates, philosophical reflections, and what I’m currently learning beyond the screen."
          />
        </PageContainer>
      </div>
      <PageContainer className="pb-16">
        <EmptyState
          icon={<LuPenLine />}
          title="The first entry is on its way"
          description="I’m still gathering my thoughts. Check back soon for the first story."
        />
      </PageContainer>
    </>
  );
}
