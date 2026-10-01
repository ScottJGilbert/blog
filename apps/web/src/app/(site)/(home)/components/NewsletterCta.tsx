import { PageContainer } from "@/components/layout/PageContainer";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";

export default function NewsletterCta() {
  return (
    <PageContainer size="wide" className="pt-8">
      <div id="newsletter" className="mx-auto max-w-2xl scroll-mt-24">
        <NewsletterSignup
          source="home"
          title="New posts, straight to your inbox"
          description="Occasional essays on engineering, making and life. Confirm once by email; unsubscribe any time."
        />
      </div>
    </PageContainer>
  );
}
