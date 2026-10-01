"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormStatus, TextField } from "@/components/ui/Field";
import { authErrorMessage, getAuthClient } from "@/lib/auth-client";
import { markSignedIn } from "@/lib/auth-store";
import { PasswordField } from "./PasswordField";
import { ResendVerification } from "./ResendVerification";
import { SocialButtons } from "./SocialButtons";
import { linkClass } from "./AuthCard";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError === "social" ? "Social sign-in didn't complete. Please try again or use your email." : null,
  );
  const [needsVerification, setNeedsVerification] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setBusy(true);
    const { error } = await getAuthClient().signIn.email({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      setNeedsVerification(error.code === "EMAIL_NOT_VERIFIED");
      setError(authErrorMessage(error));
      return;
    }
    await markSignedIn();
    router.replace(next);
    router.refresh();
  }

  return (
    <>
      <form onSubmit={submit} className="grid gap-5" noValidate>
        <TextField
          id="login-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField id="login-password" autoComplete="current-password" value={password} onChange={setPassword} />
        <FormStatus kind="error">{error}</FormStatus>
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm">
          <Link prefetch={false} href="/forgot-password" className={linkClass}>
            Forgot your password?
          </Link>
        </p>
      </form>
      {needsVerification && (
        <div className="mt-6 border-t border-border pt-6">
          <ResendVerification initialEmail={email} next={next} compact />
        </div>
      )}
      <SocialButtons next={next} />
    </>
  );
}
