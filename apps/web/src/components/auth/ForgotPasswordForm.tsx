"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormStatus, TextField } from "@/components/ui/Field";
import { authErrorMessage, getAuthClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    const { error } = await getAuthClient().requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    setBusy(false);
    if (error) setError(authErrorMessage(error));
    else setSent(true);
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <TextField
        id="forgot-email"
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <FormStatus kind="error">{error}</FormStatus>
      <FormStatus kind="success">
        {sent ? "If an account exists for that address, a reset link is on its way. It works for one hour." : null}
      </FormStatus>
      <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
