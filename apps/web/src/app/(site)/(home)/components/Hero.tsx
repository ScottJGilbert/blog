import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";

export default function Hero() {
  return (
    <section aria-label="Introduction" className="section-motif">
      <PageContainer className="py-16 sm:py-24 lg:py-28">
        <SectionHeader
          as="h1"
          size="hero"
          align="center"
          title="Welcome to my blog!"
          description="I’m Scott, a computer engineer bridging the gap between rigorous engineering and meaningful human impact with a little writing in-between. Come take a look!"
        />
      </PageContainer>
    </section>
  );
}
