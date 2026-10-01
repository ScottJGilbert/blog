"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LuMailCheck } from "react-icons/lu";
import { Button } from "@/components/ui/Button";
import { FormStatus, TextField } from "@/components/ui/Field";
import { authErrorMessage, getAuthClient } from "@/lib/auth-client";
import { markSignedIn } from "@/lib/auth-store";
import { PASSWORD_MIN, PasswordField } from "./PasswordField";
import { ResendVerification } from "./ResendVerification";
import { SocialButtons } from "./SocialButtons";

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const errors: typeof fieldErrors = {};
    if (!name.trim()) errors.name = "Tell us what to call you.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Enter a valid email address.";
    if (password.length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Move focus to the first invalid field so keyboard and screen-reader users land on the problem.
      const first = errors.name ? "signup-name" : errors.email ? "signup-email" : "signup-password";
      document.getElementById(first)?.focus();
      return;
    }

    setBusy(true);
    const { data, error } = await getAuthClient().signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      callbackURL: `/verify-email?verified=1&next=${encodeURIComponent(next)}`,
    });
    setBusy(false);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    if (data?.token) {
      // Verification not required by this deployment: the API already signed us in.
      await markSignedIn();
      router.replace(next);
      router.refresh();
      return;
    }
    setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <div>
        <div
          role="status"
          className="flex items-start gap-3 rounded-control bg-accent-soft p-4 text-accent-soft-fg"
        >
          <LuMailCheck aria-hidden className="mt-0.5 size-6 shrink-0" />
          <div>
            <p className="font-bold">Check your email</p>
            <p className="mt-1 text-sm">
              We sent a verification link to <strong className="break-all">{sentTo}</strong>. Open it to activate your
              account, then sign in. The link works for one hour.
            </p>
          </div>
        </div>
        <div className="mt-6 border-t border-border pt-6">
          <h2 className="text-base">Didn&rsquo;t get it?</h2>
          <p className="mt-1 mb-4 text-sm text-muted">Check your spam folder, or ask for a new link.</p>
          <ResendVerification initialEmail={sentTo} next={next} compact />
        </div>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={submit} className="grid gap-5" noValidate>
        <TextField
          id="signup-name"
          name="name"
          label="Name"
          autoComplete="name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
          hint="Shown next to your comments."
        />
        <TextField
          id="signup-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <PasswordField
          id="signup-password"
          autoComplete="new-password"
          showStrength
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
        />
        <FormStatus kind="error">{error}</FormStatus>
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <SocialButtons next={next} />
    </>
  );
}
