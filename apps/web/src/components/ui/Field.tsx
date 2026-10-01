import { clsx } from "clsx";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export const inputClass =
  "min-h-11 w-full min-w-0 rounded-control border border-border-strong bg-bg px-4 text-base text-fg placeholder:text-muted aria-[invalid=true]:border-danger";

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint + error wiring (aria-describedby is set by the caller through `describedBy`). */
export function FieldShell({ id, label, hint, error, children, className }: FieldShellProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
};

export function TextField({ id, label, hint, error, className, ...input }: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(inputClass, className)}
        {...input}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
};

export function TextAreaField({ id, label, hint, error, className, ...input }: TextAreaFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(inputClass, "min-h-28 resize-y py-3", className)}
        {...input}
      />
    </FieldShell>
  );
}

/** Always-mounted live region: announce results without shifting layout when empty. */
export function FormStatus({
  kind,
  children,
  className,
}: {
  kind: "error" | "success" | "info";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={clsx(
        children ? "rounded-control px-4 py-3 text-sm font-semibold" : "",
        kind === "error" && children && "border border-danger bg-surface-2 text-danger",
        kind === "success" && children && "bg-accent-soft text-accent-soft-fg",
        kind === "info" && children && "bg-surface-2 text-fg",
        className,
      )}
    >
      {children}
    </div>
  );
}
