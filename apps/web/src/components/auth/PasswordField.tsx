"use client";

import { useId, useState } from "react";
import { clsx } from "clsx";
import { LuEye, LuEyeOff } from "react-icons/lu";
import { FieldShell, inputClass } from "@/components/ui/Field";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: "" };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < PASSWORD_MIN) return { score: 1, label: `Too short: use at least ${PASSWORD_MIN} characters` };
  if (pw.length >= 14 && classes >= 3) return { score: 3, label: "Strong password" };
  if (classes >= 3 || pw.length >= 16) return { score: 3, label: "Strong password" };
  if (classes >= 2) return { score: 2, label: "Okay: a longer passphrase is stronger" };
  return { score: 1, label: "Weak: mix letters, numbers or symbols, or make it longer" };
}

/**
 * Password input with a show/hide toggle and (optionally) a strength hint. The strength text lives in an aria-live
 * region that is always mounted; its colour never carries meaning on its own (the label says it in words).
 */
export function PasswordField({
  id,
  label = "Password",
  name = "password",
  autoComplete,
  showStrength = false,
  error,
  hint,
  value,
  onChange,
}: {
  id: string;
  label?: string;
  name?: string;
  autoComplete: "current-password" | "new-password";
  showStrength?: boolean;
  error?: string | null;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const strengthId = useId();
  const strength = passwordStrength(value);
  const describedBy =
    [showStrength ? strengthId : null, hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={showStrength ? PASSWORD_MIN : undefined}
          maxLength={PASSWORD_MAX}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(inputClass, "pr-12")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label="Show password"
          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-control text-muted hover:text-fg"
        >
          {visible ? <LuEyeOff aria-hidden className="size-5" /> : <LuEye aria-hidden className="size-5" />}
        </button>
      </div>
      {showStrength && (
        <div id={strengthId} className="mt-2">
          <div aria-hidden className="flex gap-1">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={clsx("h-1.5 flex-1 rounded-full", strength.score >= n ? "bg-accent" : "bg-surface-2")}
              />
            ))}
          </div>
          <p aria-live="polite" className="mt-1 min-h-5 text-sm text-muted">
            {strength.label}
          </p>
        </div>
      )}
    </FieldShell>
  );
}
