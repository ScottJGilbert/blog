import type { Metadata } from "next";
import { LuTerminal } from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "Engineering",
  description:
    "Insights from time in the field, and lessons learned from both development and (regrettably) production.",
  alternates: { canonical: "/engineering" },
};

export default function EngineeringPage() {
  return (
    <>
      <div className="section-motif">
        <PageContainer className="pt-12 pb-10 sm:pt-16">
          <SectionHeader
            eyebrow="~/engineering"
            title="Engineering Insights"
            description="Some insights from my time in the “field”, and lessons learned from both development and (regrettably) production."
          />
        </PageContainer>
      </div>
      <PageContainer className="pb-16">
        <EmptyState
          icon={<LuTerminal />}
          title="Under construction"
          description="Check back soon for the first publication."
          status="status: compilation_in_progress"
        />
      </PageContainer>
    </>
  );
}
