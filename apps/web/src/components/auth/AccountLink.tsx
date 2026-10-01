"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LuUser, LuUserCheck } from "react-icons/lu";
import { useAuth } from "@/lib/auth-store";

const AUTH_PATH = /^\/(login|signup|forgot-password|reset-password|verify-email|auth)(\/|$)/;

/**
 * Header account control. Same box in every state (server, first client render, signed out, signed in), so the
 * session lookup can never shift the layout: `variant="header"` is an icon (below md) / fixed-width pill (md+),
 * `variant="menu"` is a full-width row inside the mobile menu panel.
 */
export function AccountLink({ variant }: { variant: "header" | "menu" }) {
  const pathname = usePathname();
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const href = signedIn
    ? "/account"
    : AUTH_PATH.test(pathname) || pathname === "/"
      ? "/login"
      : `/login?next=${encodeURIComponent(pathname)}`;
  const Icon = signedIn ? LuUserCheck : LuUser;
  const label = signedIn ? "Account" : "Sign in";

  if (variant === "menu") {
    return (
      <Link
        prefetch={false}
        href={href}
        aria-current={pathname === "/account" ? "page" : undefined}
        className="flex min-h-11 items-center gap-2 rounded-full px-4 text-base font-semibold text-fg transition-colors hover:bg-surface-2 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-fg"
      >
        <Icon aria-hidden className="size-5" />
        {label}
      </Link>
    );
  }
  return (
    <Link
      prefetch={false}
      href={href}
      aria-current={pathname === "/account" ? "page" : undefined}
      className={clsx(
        "hidden h-11 w-28 items-center justify-center gap-2 rounded-full border border-border-strong text-sm font-semibold text-fg transition-colors hover:bg-surface-2 md:inline-flex",
        "aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-fg",
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </Link>
  );
}
