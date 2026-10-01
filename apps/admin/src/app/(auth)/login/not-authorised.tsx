"use client";

import { useState } from "react";
import { LuShieldAlert } from "react-icons/lu";
import { AnchorButton, Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { SITE_URL, withBase } from "@/lib/base-path";

export function NotAuthorised({ name, email }: { name: string; email: string }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await authClient.signOut();
    } finally {
      window.location.assign(withBase("/login"));
    }
  }
  return (
    <div className="rounded-xl border border-edge bg-panel p-6 text-center shadow-sm">
      <div aria-hidden className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-danger-soft text-danger">
        <LuShieldAlert className="size-6" />
      </div>
      <h1 className="text-xl font-semibold">Not authorised</h1>
      <p className="mt-2 text-sm text-muted">
        You are signed in as <strong className="font-semibold text-ink">{name}</strong> ({email}), but this account does not have
        administrator access. Ask an administrator to grant you the admin role, or sign in with a different account.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" onClick={signOut} loading={busy}>
          Sign out
        </Button>
        <AnchorButton href={SITE_URL || "/"} variant="ghost">
          Go to the public site
        </AnchorButton>
      </div>
    </div>
  );
}
