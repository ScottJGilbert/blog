"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { SmartLink } from "@/components/ui/SmartLink";

const STORAGE_KEY = "blog-consent";
const EVENT = "blog-consent-change";

type Choice = "accepted" | "declined";

function read(): Choice | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Optional consent notice (currently not mounted anywhere: the site only uses
 * cookieless analytics and a theme preference in localStorage). It is `fixed`,
 * so it can never shift page content, and it renders nothing on the server or
 * before the stored choice is known (no flash for returning visitors).
 */
export default function CookieBanner({
  privacyHref = "/about",
  onChoice,
}: {
  privacyHref?: string;
  onChoice?: (choice: Choice) => void;
}) {
  // Server + hydration snapshot is "decided" so nothing is rendered until the
  // client has read the stored value.
  const choice = useSyncExternalStore<Choice | null>(
    subscribe,
    read,
    () => "declined",
  );

  if (choice) return null;

  const decide = (next: Choice) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore: the notice simply reappears next visit */
    }
    window.dispatchEvent(new Event(EVENT));
    onChoice?.(next);
  };

  return (
    <section
      aria-labelledby="consent-title"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-2xl flex-col gap-4 rounded-card border border-border-strong bg-surface p-5 text-fg shadow-card-hover sm:flex-row sm:items-center"
    >
      <div className="flex-1">
        <h2 id="consent-title" className="text-base">
          Privacy notice
        </h2>
        <p className="mt-1 text-sm text-muted">
          This site only stores what it needs to work, such as your theme
          choice. Optional analytics run only if you accept.{" "}
          <SmartLink
            href={privacyHref}
            className="font-semibold text-accent underline underline-offset-4"
          >
            Learn more
          </SmartLink>
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="primary" onClick={() => decide("accepted")}>
          Accept
        </Button>
        <Button variant="secondary" onClick={() => decide("declined")}>
          Decline
        </Button>
      </div>
    </section>
  );
}
