"use client";

import { isApiError } from "@blog/shared/client";
import { browserApi } from "@/lib/browser-api";
import { NewsletterForm, type NewsletterResult } from "./NewsletterForm";

/**
 * The A1 NewsletterForm shell wired to POST /api/newsletter/subscribe (double opt-in: the API always answers 202
 * and mails a confirmation link, so the success copy never reveals whether the address was already known).
 */
export function NewsletterSignup({
  source,
  title,
  description,
  className,
}: {
  /** Where the sign-up happened (`home`, `footer`, `post`), stored with the subscriber. */
  source: string;
  title?: string;
  description?: string;
  className?: string;
}) {
  async function onSubmit(email: string): Promise<NewsletterResult> {
    try {
      await browserApi.newsletter.subscribe({ email, source });
      return { ok: true, message: "Almost done! Check your inbox for a link to confirm your subscription." };
    } catch (err) {
      if (isApiError(err) && err.isValidation) return { ok: false, message: "That doesn't look like a valid email address." };
      if (isApiError(err) && err.isRateLimited) return { ok: false, message: "Too many attempts. Please try again in a minute." };
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  }
  return <NewsletterForm onSubmit={onSubmit} title={title} description={description} className={className} />;
}
