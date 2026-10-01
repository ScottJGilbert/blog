import type { Metadata } from "next";
import { NewsletterResult } from "@/components/newsletter/NewsletterResult";
import { NewsletterTokenAction } from "@/components/newsletter/NewsletterTokenAction";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Landing page of the emailed unsubscribe link. Opening it changes nothing (mail scanners open links): the visitor
 * confirms with a button, which POSTs the token to the API from the browser. (Mail clients' one-click
 * List-Unsubscribe talks to the API directly.)
 */
export default async function UnsubscribePage({ searchParams }: PageProps<"/newsletter/unsubscribe">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  if (token.length < 8) {
    return (
      <NewsletterResult ok={false} title="This link didn't work">
        <p>The unsubscribe link is invalid. If you keep receiving emails, reply to one and we&rsquo;ll remove you by hand.</p>
      </NewsletterResult>
    );
  }
  return <NewsletterTokenAction kind="unsubscribe" token={token} />;
}
