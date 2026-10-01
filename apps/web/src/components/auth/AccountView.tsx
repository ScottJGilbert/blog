"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isApiError } from "@/lib/api-error";
import { LuBadgeCheck, LuTriangleAlert } from "react-icons/lu";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormStatus, TextField } from "@/components/ui/Field";
import { authErrorMessage, getAuthClient } from "@/lib/auth-client";
import { markSignedOut, setMe, useAuth } from "@/lib/auth-store";
import { getBrowserApi } from "@/lib/browser-api";
import { PASSWORD_MIN, PasswordField } from "./PasswordField";
import { ResendVerification } from "./ResendVerification";

function Panel({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-border bg-surface p-5 shadow-card sm:p-7">
      <h2 id={id} className="text-xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Set while we navigate away on purpose (sign out / delete) so the anonymous state doesn't bounce to /login. */
let leaving = false;

export function AccountView() {
  const router = useRouter();
  const auth = useAuth({ force: true });

  useEffect(() => {
    leaving = false;
  }, []);
  useEffect(() => {
    if (auth.status === "anonymous" && !leaving) router.replace(`/login?next=${encodeURIComponent("/account")}`);
  }, [auth.status, router]);

  // Fixed-height placeholder: the page frame is identical before and after the lookup.
  if (auth.status !== "authenticated") {
    return (
      <div role="status" aria-label="Loading your account" className="grid gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} aria-hidden className="h-40 rounded-card border border-border bg-surface motion-safe:animate-pulse" />
        ))}
      </div>
    );
  }
  return <AccountPanels />;
}

function AccountPanels() {
  const router = useRouter();
  const auth = useAuth();
  const me = auth.me!;

  return (
    <div className="grid gap-6">
      <ProfilePanel />
      <NewsletterPanel verified={me.emailVerified} status={me.subscription?.status ?? null} />
      <PasswordPanel />
      <Panel title="Session" id="session-title">
        <SignOutButton onDone={() => router.push("/")} />
      </Panel>
      <DeletePanel email={me.email} isAdmin={me.role === "admin"} />
    </div>
  );
}

function ProfilePanel() {
  const auth = useAuth();
  const me = auth.me!;
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setStatus({ kind: "error", text: "Name can't be empty." });
    setBusy(true);
    setStatus(null);
    try {
      setMe(await (await getBrowserApi()).updateMe({ name: trimmed }));
      setStatus({ kind: "success", text: "Profile saved." });
    } catch (err) {
      setStatus({ kind: "error", text: isApiError(err) && err.code === "validation_error" ? "That name isn't valid." : "Couldn't save your profile. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Profile" id="profile-title">
      <dl className="mb-5 grid gap-1 text-sm">
        <dt className="font-bold">Email</dt>
        <dd className="flex flex-wrap items-center gap-2 text-muted">
          <span className="break-all">{me.email}</span>
          {me.emailVerified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-soft-fg">
              <LuBadgeCheck aria-hidden className="size-4" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-danger">
              <LuTriangleAlert aria-hidden className="size-4" /> Not verified
            </span>
          )}
        </dd>
      </dl>
      {!me.emailVerified && (
        <div className="mb-5 rounded-control border border-border p-4">
          <p className="mb-3 text-sm text-muted">Verify your email to comment and manage your subscription.</p>
          <ResendVerification initialEmail={me.email} next="/account" compact />
        </div>
      )}
      <form onSubmit={save} className="grid gap-4" noValidate>
        <TextField
          id="profile-name"
          label="Display name"
          autoComplete="name"
          maxLength={80}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div>
          <Button type="submit" disabled={busy || name.trim() === me.name} aria-busy={busy}>
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </div>
        <FormStatus kind={status?.kind ?? "success"}>{status?.text}</FormStatus>
      </form>
    </Panel>
  );
}

const SUB_TEXT = {
  confirmed: "You're subscribed.",
  pending: "Waiting for you to confirm the email we sent.",
  unsubscribed: "You're unsubscribed.",
} as const;

function NewsletterPanel({ verified, status }: { verified: boolean; status: "pending" | "confirmed" | "unsubscribed" | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const subscribed = status === "confirmed";

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      await (await getBrowserApi()).subscription.set(!subscribed);
      // Refresh the cached profile so the header/comments see the new state.
      setMe(await (await getBrowserApi()).me({ cache: "no-store" }));
      setMessage({ kind: "success", text: subscribed ? "You've been unsubscribed." : "You're subscribed. Thanks!" });
    } catch (err) {
      setMessage({
        kind: "error",
        text: isApiError(err) && err.status === 403 ? "Verify your email address first." : "Couldn't update your subscription. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Newsletter" id="newsletter-title">
      <p className="text-muted">
        New posts by email, no spam. {status ? SUB_TEXT[status] : "You're not subscribed."}
      </p>
      <div className="mt-4">
        <Button
          variant={subscribed ? "secondary" : "primary"}
          onClick={toggle}
          disabled={busy || (!verified && !subscribed)}
          aria-busy={busy}
          aria-pressed={subscribed}
        >
          {subscribed ? "Unsubscribe" : "Subscribe"}
        </Button>
        {!verified && !subscribed && <p className="mt-2 text-sm text-muted">Verify your email address to subscribe.</p>}
      </div>
      <FormStatus kind={message?.kind ?? "success"} className="mt-3">
        {message?.text}
      </FormStatus>
    </Panel>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus(null);
    if (next.length < PASSWORD_MIN) return setStatus({ kind: "error", text: `Use at least ${PASSWORD_MIN} characters.` });
    setBusy(true);
    const { error } = await getAuthClient().changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (error) {
      setStatus({ kind: "error", text: error.code === "INVALID_PASSWORD" ? "Your current password is incorrect." : authErrorMessage(error) });
    } else {
      setCurrent("");
      setNext("");
      setStatus({ kind: "success", text: "Password changed. Other devices were signed out." });
    }
  }

  return (
    <Panel title="Change password" id="password-title">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <PasswordField id="current-password" label="Current password" name="currentPassword" autoComplete="current-password" value={current} onChange={setCurrent} />
        <PasswordField id="new-password" label="New password" name="newPassword" autoComplete="new-password" showStrength value={next} onChange={setNext} />
        <div>
          <Button type="submit" variant="secondary" disabled={busy || !current || !next} aria-busy={busy}>
            {busy ? "Saving…" : "Change password"}
          </Button>
        </div>
        <FormStatus kind={status?.kind ?? "success"}>{status?.text}</FormStatus>
      </form>
      <p className="mt-4 text-sm text-muted">
        Signed up with Google or GitHub? You don&rsquo;t have a password; use{" "}
        <Link href="/forgot-password" className="font-semibold text-accent underline underline-offset-4">
          reset password
        </Link>{" "}
        to set one.
      </p>
    </Panel>
  );
}

function SignOutButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await getAuthClient().signOut();
        leaving = true;
        markSignedOut();
        onDone();
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}

function DeletePanel({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await (await getBrowserApi()).deleteMe();
      leaving = true;
      markSignedOut();
      router.push("/");
    } catch (err) {
      setBusy(false);
      setError(
        isApiError(err) && err.status === 403
          ? "Administrators can't delete their own account. Ask another administrator to demote you first."
          : "Couldn't delete your account. Please try again.",
      );
    }
  }

  return (
    <Panel title="Delete account" id="delete-title">
      <p className="text-muted">
        This removes your sign-in and newsletter subscription. Your comments stay, shown as &ldquo;Deleted user&rdquo;. It
        can&rsquo;t be undone.
      </p>
      <div className="mt-4">
        <Button variant="danger-outline" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setTyped("");
          setError(null);
        }}
        title="Delete your account?"
        description="This can't be undone."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirmDelete();
          }}
          className="grid gap-4"
          noValidate
        >
          <TextField
            id="delete-confirm"
            label={
              <>
                Type <span className="font-mono">delete</span> to confirm
              </>
            }
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {isAdmin && <p className="text-sm text-danger">You are an administrator; the server will refuse this.</p>}
          <FormStatus kind="error">{error}</FormStatus>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="danger" disabled={busy || typed.trim().toLowerCase() !== "delete"} aria-busy={busy}>
              {busy ? "Deleting…" : "Delete account"}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="sr-only">Account: {email}</p>
        </form>
      </Dialog>
    </Panel>
  );
}
