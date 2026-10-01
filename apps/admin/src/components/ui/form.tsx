"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** visually hide the label (still announced) */
  hideLabel?: boolean;
  children: (control: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
    "aria-required"?: true;
  }) => ReactNode;
}

/** Label + control + hint + inline error, wired with ids (`aria-describedby`, `aria-invalid`). */
export function Field({ label, hint, error, required, className, hideLabel, children }: FieldProps) {
  const uid = useId();
  const id = `f${uid}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className={cn("block text-sm font-medium", hideLabel && "sr-only")}>
        {label}
        {required ? (
          <span aria-hidden className="text-danger">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(required ? { "aria-required": true as const } : {}),
      })}
      {hint ? (
        <p id={hintId} className="text-[0.8125rem] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="text-[0.8125rem] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Shared = Pick<FieldProps, "label" | "hint" | "error" | "hideLabel"> & { wrapperClassName?: string };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Shared>(function Input(
  { label, hint, error, hideLabel, wrapperClassName, className, required, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={wrapperClassName} hideLabel={hideLabel}>
      {(c) => <input ref={ref} className={cn("ctl", className)} required={false} {...c} {...rest} />}
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Shared>(
  function Textarea({ label, hint, error, hideLabel, wrapperClassName, className, required, ...rest }, ref) {
    return (
      <Field label={label} hint={hint} error={error} required={required} className={wrapperClassName} hideLabel={hideLabel}>
        {(c) => <textarea ref={ref} className={cn("ctl min-h-24 resize-y", className)} {...c} {...rest} />}
      </Field>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Shared>(function Select(
  { label, hint, error, hideLabel, wrapperClassName, className, required, children, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={wrapperClassName} hideLabel={hideLabel}>
      {(c) => (
        <select ref={ref} className={cn("ctl pr-9", className)} {...c} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
});

export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        className="size-4 rounded border-edge-strong bg-panel text-brand focus-visible:outline-2 focus-visible:outline-brand"
        {...rest}
      />
      {label}
    </label>
  );
}

/** Top-of-form error summary (role=alert). */
export function FormError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <div
      id={id}
      role="alert"
      className="rounded-ctl border border-danger/50 bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
    >
      {children}
    </div>
  );
}
