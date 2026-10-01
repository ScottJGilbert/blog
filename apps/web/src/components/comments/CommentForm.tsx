"use client";

import { useId, useRef, useState } from "react";
import { COMMENT_MAX_LENGTH } from "@blog/shared";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

/**
 * Plain-text comment composer with a live character counter. `onSubmit` resolves when the (optimistic) post was
 * accepted, or rejects with an Error whose message is shown (the text is kept so nothing is lost).
 */
export function CommentForm({
  label,
  submitLabel = "Post comment",
  initialValue = "",
  autoFocus = false,
  onSubmit,
  onCancel,
  rows = 4,
}: {
  label: string;
  submitLabel?: string;
  initialValue?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  rows?: number;
}) {
  const uid = useId();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const remaining = COMMENT_MAX_LENGTH - value.length;
  const tooLong = remaining < 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || tooLong || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      ref.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <div>
        <label htmlFor={`${uid}-body`} className="block text-sm font-bold">
          {label}
        </label>
        <textarea
          ref={ref}
          id={`${uid}-body`}
          name="body"
          rows={rows}
          autoFocus={autoFocus}
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit(e);
          }}
          aria-invalid={tooLong || error ? true : undefined}
          aria-describedby={`${uid}-count ${uid}-error`}
          className={clsx(inputClass, "mt-2 min-h-28 resize-y py-3 leading-relaxed")}
        />
        <div className="mt-1 flex items-start justify-between gap-3 text-sm">
          <p id={`${uid}-error`} role="alert" className="min-h-5 font-semibold text-danger">
            {error}
          </p>
          <p
            id={`${uid}-count`}
            className={clsx("shrink-0 tabular-nums", tooLong ? "font-bold text-danger" : "text-muted")}
            aria-live={remaining <= 100 ? "polite" : "off"}
          >
            <span className="sr-only">Characters remaining: </span>
            {remaining}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || !trimmed || tooLong} aria-busy={busy}>
          {busy ? "Posting…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
