"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormStatus, TextField } from "@/components/ui/Field";
import { authErrorMessage, getAuthClient } from "@/lib/auth-client";

/** "Send me a new verification link". Same neutral answer whether or not the address exists. */
export function ResendVerification({
  initialEmail = "",
  next = "/",
  compact = false,
}: {
  initialEmail?: string;
  next?: string;
  compact?: boolean;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setState("error");
      setMessage("Enter the email address you signed up with.");
      return;
    }
    setState("sending");
    const { error } = await getAuthClient().sendVerificationEmail({
      email: email.trim(),
      callbackURL: `/verify-email?verified=1&next=${encodeURIComponent(next)}`,
    });
    if (error) {
      setState("error");
      setMessage(authErrorMessage(error));
    } else {
      setState("sent");
      setMessage("If that address has an unverified account, a new link is on its way. It can take a minute to arrive.");
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <TextField
        id="resend-email"
        label={compact ? "Email address" : "Email address to verify"}
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={state === "sending"} aria-busy={state === "sending"}>
        {state === "sending" ? "Sending…" : "Resend verification email"}
      </Button>
      <FormStatus kind={state === "error" ? "error" : "success"}>
        {state === "sent" || state === "error" ? message : null}
      </FormStatus>
    </form>
  );
}
