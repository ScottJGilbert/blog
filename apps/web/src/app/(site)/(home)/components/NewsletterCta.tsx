import { LuMailPlus } from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";

export default function NewsletterCta() {
  return (
    <PageContainer size="wide" className="pt-8">
      <div
        id="newsletter"
        className="relative mx-auto max-w-2xl scroll-mt-24 -rotate-1 rounded-card bg-linear-to-br from-accent to-accent-soft p-1.5 shadow-card"
      >
        <LuMailPlus
          aria-hidden
          className="absolute -top-5 -right-3 size-12 rotate-12 rounded-full bg-bg p-3 text-accent shadow-card"
        />
        <div className="rotate-1">
          <NewsletterSignup
            source="home"
            title="Don’t miss the next one ✉️"
            description="Essays on engineering, making and life, delivered when they’re fresh. Be the first to hear about new posts."
            className="border-0 shadow-none"
          />
        </div>
      </div>
    </PageContainer>
  );
}
