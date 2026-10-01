"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { LuEye, LuEyeOff } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/form";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { withBase } from "@/lib/base-path";
import { fieldErrorsFromZod, type FieldErrors } from "@/lib/errors";
import { NotAuthorised } from "./not-authorised";

const LoginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").pipe(z.email("Enter a valid email address.")),
  password: z.string().min(1, "Enter your password."),
});

export function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [denied, setDenied] = useState<{ name: string; email: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = LoginSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error.issues));
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const { error } = await authClient.signIn.email({ email: parsed.data.email, password: parsed.data.password });
      if (error) {
        const status = error.status ?? 0;
        setFormError(
          status === 429
            ? "Too many attempts. Wait a minute and try again."
            : status === 403
              ? error.message || "This account cannot sign in."
              : status >= 500 || status === 0
                ? "Sign-in is temporarily unavailable. Please try again."
                : "Incorrect email or password.",
        );
        return;
      }
      const me = await api.me();
      if (me.role !== "admin") {
        setDenied({ name: me.name, email: me.email });
        return;
      }
      window.location.assign(withBase(next));
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <NotAuthorised {...denied} />;

  return (
    <div className="rounded-xl border border-edge bg-panel p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2.5">
        <span aria-hidden className="grid size-9 place-items-center rounded-lg bg-brand text-brand-ink">
          <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M8 10h16M8 16h16M8 22h9" />
          </svg>
        </span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Sign in</h1>
          <p className="text-[0.8125rem] text-muted">Blog administration</p>
        </div>
      </div>

      {notice ? (
        <p role="status" className="mb-4 rounded-ctl border border-warn/40 bg-warn-soft px-3 py-2 text-sm font-medium text-warn">
          {notice}
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError>{formError}</FormError>
        <Field label="Email" error={errors.email} required>
          {(c) => <input {...c} name="email" type="email" autoComplete="username" inputMode="email" className="ctl" autoFocus />}
        </Field>
        <Field label="Password" error={errors.password} required>
          {(c) => (
            <div className="relative">
              <input {...c} name="password" type={show ? "text" : "password"} autoComplete="current-password" className="ctl pr-11" />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
                aria-pressed={show}
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-ctl text-muted hover:text-ink"
              >
                {show ? <LuEyeOff aria-hidden className="size-4" /> : <LuEye aria-hidden className="size-4" />}
              </button>
            </div>
          )}
        </Field>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
