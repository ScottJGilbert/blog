"use client";

import { useEffect, useRef, useState } from "react";
import { LuMailCheck } from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button, ButtonLink } from "@/components/ui/Button";
import { hasStatus, isApiError } from "@/lib/api-error";
import { getBrowserApi } from "@/lib/browser-api";
import { NewsletterResult } from "./NewsletterResult";

type Kind = "confirm" | "unsubscribe";
type Phase = "idle" | "busy" | "done" | "invalid" | "unavailable";

const COPY = {
  confirm: {
    title: "Confirm your subscription",
    text: "One more step: confirm that you want new posts by email.",
    action: "Confirm subscription",
    busy: "Confirming…",
  },
  unsubscribe: {
    title: "Unsubscribe from the newsletter?",
    text: "You will stop receiving new posts by email. You can subscribe again at any time.",
    action: "Unsubscribe",
    busy: "Unsubscribing…",
  },
} as const;

/**
 * Emailed confirm / unsubscribe links must not change anything on a plain GET: mail-security scanners and link
 * previewers open every link in a message and would silently confirm or unsubscribe people. The link lands here, and the
 * change is made by an explicit click (POST).
 */
export function NewsletterTokenAction({ kind, token }: { kind: Kind; token: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const copy = COPY[kind];

  // After the click the card is replaced by the outcome: move focus to its heading so it is announced.
  useEffect(() => {
    if (phase === "idle" || phase === "busy") return;
    rootRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [phase]);

  async function run() {
    setPhase("busy");
    try {
      const api = await getBrowserApi();
      if (kind === "confirm") await api.newsletter.confirm(token);
      else await api.newsletter.unsubscribe(token);
      setPhase("done");
    } catch (err) {
      setPhase(isApiError(err) && err.status >= 400 && err.status < 500 && !hasStatus(err, 429) ? "invalid" : "unavailable");
    }
  }

  if (phase === "done" || phase === "invalid" || phase === "unavailable") {
    return (
      <div ref={rootRef}>
        <Outcome kind={kind} phase={phase} />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="section-motif">
      <PageContainer size="prose" className="py-16 text-center sm:py-24">
        <div aria-hidden className="mx-auto mb-6 flex size-16 items-center justify-center rounded-card bg-accent-soft text-3xl text-accent-soft-fg">
          <LuMailCheck />
        </div>
        <h1 tabIndex={-1} className="text-h1 text-fg outline-none">
          {copy.title}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-lg text-muted">{copy.text}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={run} disabled={phase === "busy"} aria-busy={phase === "busy"} variant={kind === "confirm" ? "primary" : "danger"}>
            {phase === "busy" ? copy.busy : copy.action}
          </Button>
          <ButtonLink href="/" variant="secondary" size="lg">
            Back to the blog
          </ButtonLink>
        </div>
      </PageContainer>
    </div>
  );
}

function Outcome({ kind, phase }: { kind: Kind; phase: "done" | "invalid" | "unavailable" }) {
  if (kind === "confirm") {
    if (phase === "done") {
      return (
        <NewsletterResult ok title="You're subscribed">
          <p>Thanks for confirming. New posts will land in your inbox. You can unsubscribe at any time from any email.</p>
        </NewsletterResult>
      );
    }
    if (phase === "unavailable") {
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
  if (phase === "done") {
    return (
      <NewsletterResult ok title="You're unsubscribed" retryHref="/#newsletter">
        <p>You won&rsquo;t receive any more newsletters. Changed your mind? You can subscribe again at any time.</p>
      </NewsletterResult>
    );
  }
  if (phase === "unavailable") {
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
