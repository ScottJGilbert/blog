"use client";

import { useId, useState, type FormEvent } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";

export interface NewsletterResult {
  ok: boolean;
  /** Message announced to assistive tech and shown under the form. */
  message?: string;
}

interface NewsletterFormProps {
  /**
   * Called with the trimmed e-mail. Resolve with `{ ok, message }` (or throw)
   * to drive the status line. Without a handler the form reports that sign-up
   * is not available yet; this component itself never touches the network.
   */
  onSubmit?: (email: string) => Promise<NewsletterResult | void>;
  title?: string;
  description?: string;
  submitLabel?: string;
  className?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

/**
 * Presentational newsletter sign-up shell: labelled e-mail field, submit button
 * and an always-mounted aria-live status line (reserved height, so announcing a
 * result never shifts the layout).
 */
export function NewsletterForm({
  onSubmit,
  title = "Get new posts by email",
  description = "No spam. Unsubscribe any time.",
  submitLabel = "Subscribe",
  className,
}: NewsletterFormProps) {
  const uid = useId();
  const inputId = `${uid}-email`;
  const statusId = `${uid}-status`;
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) {
      setStatus({ kind: "error", message: "Please enter your email address." });
      return;
    }
    if (!onSubmit) {
      setStatus({
        kind: "error",
        message: "Newsletter sign-up isn't available yet.",
      });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const result = await onSubmit(email);
      if (result && !result.ok) {
        setStatus({
          kind: "error",
          message: result.message ?? "Something went wrong. Please try again.",
        });
        return;
      }
      setStatus({
        kind: "success",
        message: result?.message ?? "Thanks! Check your inbox to confirm.",
      });
      form.reset();
    } catch {
      setStatus({
        kind: "error",
        message: "Something went wrong. Please try again.",
      });
    }
  }

  const message =
    status.kind === "success" || status.kind === "error" ? status.message : "";

  return (
    <section
      aria-labelledby={`${uid}-title`}
      className={clsx(
        "rounded-card border border-border bg-surface p-6 text-fg sm:p-8",
        className,
      )}
    >
      <h2 id={`${uid}-title`} className="text-2xl">
        {title}
      </h2>
      <p className="mt-2 text-muted">{description}</p>

      <form onSubmit={handleSubmit} noValidate className="mt-5">
        <label htmlFor={inputId} className="block text-sm font-bold">
          Email address
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id={inputId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            aria-invalid={status.kind === "error"}
            aria-describedby={statusId}
            className="min-h-11 min-w-0 flex-1 rounded-control border border-border-strong bg-bg px-4 text-base text-fg placeholder:text-muted"
          />
          <Button
            type="submit"
            disabled={status.kind === "submitting"}
            aria-busy={status.kind === "submitting"}
          >
            {status.kind === "submitting" ? "Subscribing…" : submitLabel}
          </Button>
        </div>
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className={clsx(
            "mt-3 min-h-6 text-sm",
            status.kind === "error"
              ? "font-semibold text-danger"
              : "text-muted",
          )}
        >
          {message}
        </p>
      </form>
    </section>
  );
}
