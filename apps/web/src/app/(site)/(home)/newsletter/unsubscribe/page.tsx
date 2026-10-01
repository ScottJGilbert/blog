import type { Metadata } from "next";
import { NewsletterResult } from "@/components/newsletter/NewsletterResult";
import { api } from "@/lib/api";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Outcome = "unsubscribed" | "invalid" | "unavailable";

async function unsubscribe(token: string): Promise<Outcome> {
  if (token.length < 8) return "invalid";
  try {
    await api.newsletter.unsubscribe(token, { cache: "no-store" });
    return "unsubscribed";
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    return status >= 400 && status < 500 ? "invalid" : "unavailable";
  }
}

export default async function UnsubscribePage({ searchParams }: PageProps<"/newsletter/unsubscribe">) {
  const sp = await searchParams;
  const outcome = await unsubscribe(typeof sp.token === "string" ? sp.token : "");

  if (outcome === "unsubscribed") {
    return (
      <NewsletterResult ok title="You're unsubscribed" retryHref="/#newsletter">
        <p>You won&rsquo;t receive any more newsletters. Changed your mind? You can subscribe again at any time.</p>
      </NewsletterResult>
    );
  }
  if (outcome === "unavailable") {
    return (
      <NewsletterResult ok={false} title="We couldn't unsubscribe you right now">
        <p>The service is temporarily unavailable. Please reload this page in a minute to try again.</p>
      </NewsletterResult>
    );
  }
  return (
    <NewsletterResult ok={false} title="This link didn't work">
      <p>The unsubscribe link is invalid. If you keep receiving emails, reply to one and we&rsquo;ll remove you by hand.</p>
    </NewsletterResult>
  );
}
