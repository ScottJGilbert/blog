"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { FormStatus } from "@/components/ui/Field";
import { authErrorMessage, getAuthClient } from "@/lib/auth-client";
import { linkClass } from "./AuthCard";
import { PASSWORD_MIN, PasswordField } from "./PasswordField";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const { error } = await getAuthClient().resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) setError(authErrorMessage(error));
    else setDone(true);
  }

  if (done) {
    return (
      <div role="status">
        <p className="font-bold">Your password has been updated.</p>
        <p className="mt-2 text-muted">For your security you were signed out everywhere.</p>
        <p className="mt-6">
          <Link href="/login" className={linkClass}>
            Continue to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <PasswordField
        id="reset-password"
        label="New password"
        autoComplete="new-password"
        showStrength
        value={password}
        onChange={setPassword}
      />
      <PasswordField
        id="reset-confirm"
        label="Confirm new password"
        name="confirm"
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
      />
      <FormStatus kind="error">{error}</FormStatus>
      <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
