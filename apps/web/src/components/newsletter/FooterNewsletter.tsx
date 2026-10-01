"use client";

import { usePathname } from "next/navigation";
import { NewsletterSignup } from "./NewsletterSignup";

/** Footer sign-up; hidden where the page already carries its own call to action (home, post pages). */
export function FooterNewsletter() {
  const pathname = usePathname();
  if (pathname === "/" || /^\/(personal|engineering)\/[^/]+$/.test(pathname)) return null;
  return (
    <NewsletterSignup
      source="footer"
      title="Get new posts by email"
      description="One email per new post. No spam, unsubscribe any time."
      className="mb-12 bg-bg"
    />
  );
}
