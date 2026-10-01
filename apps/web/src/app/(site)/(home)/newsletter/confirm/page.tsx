import type { Metadata } from "next";
import { NewsletterResult } from "@/components/newsletter/NewsletterResult";
import { api } from "@/lib/api";

export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Outcome = "confirmed" | "invalid" | "unavailable";

async function confirm(token: string): Promise<Outcome> {
  if (token.length < 8) return "invalid";
  try {
    await api.newsletter.confirm(token, { cache: "no-store" });
    return "confirmed";
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    return status >= 400 && status < 500 ? "invalid" : "unavailable";
  }
}

export default async function ConfirmPage({ searchParams }: PageProps<"/newsletter/confirm">) {
  const sp = await searchParams;
  const outcome = await confirm(typeof sp.token === "string" ? sp.token : "");

  if (outcome === "confirmed") {
    return (
      <NewsletterResult ok title="You're subscribed">
        <p>Thanks for confirming. New posts will land in your inbox. You can unsubscribe at any time from any email.</p>
      </NewsletterResult>
    );
  }
  if (outcome === "unavailable") {
    return (
      <NewsletterResult ok={false} title="We couldn't confirm that right now">
        <p>The service is temporarily unavailable. Please reload this page in a minute; your link is still valid.</p>
      </NewsletterResult>
    );
  }
  return (
    <NewsletterResult ok={false} title="This link didn't work" retryHref="/#newsletter">
      <p>The confirmation link is invalid or has expired. Subscribe again and we&rsquo;ll send you a fresh one.</p>
    </NewsletterResult>
  );
}
