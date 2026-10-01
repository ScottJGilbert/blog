import type { Metadata } from "next";
import { NewsletterResult } from "@/components/newsletter/NewsletterResult";
import { NewsletterTokenAction } from "@/components/newsletter/NewsletterTokenAction";

export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Landing page of the emailed confirmation link. Opening it changes nothing (mail scanners open links): the visitor
 * confirms with a button, which POSTs the token to the API from the browser.
 */
export default async function ConfirmPage({ searchParams }: PageProps<"/newsletter/confirm">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  if (token.length < 8) {
    return (
      <NewsletterResult ok={false} title="This link didn't work" retryHref="/#newsletter">
        <p>The confirmation link is invalid or has expired. Subscribe again and we&rsquo;ll send you a fresh one.</p>
      </NewsletterResult>
    );
  }
  return <NewsletterTokenAction kind="confirm" token={token} />;
}
