"use client";

import { useRouter } from "next/navigation";
import { NewsletterForm } from "./NewsletterForm";

/** Subscriptions require an account, so the form just hands the typed address to the sign-in page. */
export function NewsletterSignup({
  title,
  description,
  className,
}: {
  /** Kept so callers can say where the form sits; unused now that sign-up happens after sign-in. */
  source?: string;
  title?: string;
  description?: string;
  className?: string;
}) {
  const router = useRouter();
  async function onSubmit(email: string) {
    router.push(`/login?email=${encodeURIComponent(email)}`);
    await new Promise(() => {}); // stay "Subscribing…" until navigation lands
  }
  return (
    <NewsletterForm
      onSubmit={onSubmit}
      title={title}
      description={description}
      submitLabel="Subscribe"
      className={className}
    />
  );
}
