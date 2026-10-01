"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/form";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, timeZoneLabel, toLocalInputValue } from "@/lib/format";

/** Date/time picker (local time, with the time zone shown explicitly) that resolves to an ISO UTC timestamp. */
export function ScheduleDialog({
  open,
  onClose,
  onSchedule,
  initial,
  title = "Schedule publication",
  description = "Choose when this should go live.",
  submitLabel = "Schedule",
}: {
  open: boolean;
  onClose: () => void;
  onSchedule: (iso: string) => Promise<void>;
  initial?: string | null;
  title?: string;
  description?: string;
  submitLabel?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="sm">
      {open ? <ScheduleForm onClose={onClose} onSchedule={onSchedule} initial={initial} submitLabel={submitLabel} /> : null}
    </Dialog>
  );
}

function defaultValue(initial?: string | null): string {
  if (initial) return toLocalInputValue(initial);
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return toLocalInputValue(d);
}

function ScheduleForm({
  onClose,
  onSchedule,
  initial,
  submitLabel,
}: {
  onClose: () => void;
  onSchedule: (iso: string) => Promise<void>;
  initial?: string | null;
  submitLabel: string;
}) {
  const [value, setValue] = useState(() => defaultValue(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const date = value ? new Date(value) : null;
  const valid = date !== null && !Number.isNaN(date.getTime());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !date) {
      setError("Choose a valid date and time.");
      return;
    }
    if (date.getTime() <= Date.now() + 30_000) {
      setError("Choose a time in the future.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSchedule(date.toISOString());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Publish on" error={error && !valid ? error : null} hint={`Time zone: ${timeZoneLabel(valid && date ? date : undefined)}`}>
        {(c) => (
          <input
            {...c}
            type="datetime-local"
            className="ctl"
            value={value}
            min={toLocalInputValue(new Date())}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            data-autofocus
          />
        )}
      </Field>
      {valid && date ? (
        <p className="text-[0.8125rem] text-muted">
          Goes live <strong className="font-semibold text-ink">{formatDateTime(date.toISOString())}</strong> ({date.toISOString().replace(".000Z", "Z")})
        </p>
      ) : null}
      {error && valid ? <FormError>{error}</FormError> : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
