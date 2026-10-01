"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LuChevronDown, LuExternalLink, LuLogOut, LuMenu, LuMonitor, LuMoon, LuSun } from "react-icons/lu";
import type { Me } from "@blog/shared";
import { IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";
import { SITE_URL, withBase } from "@/lib/base-path";
import { useTheme } from "@/providers/theme-provider";
import { SidebarNav } from "./sidebar-nav";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md py-1 text-[0.9375rem] font-semibold tracking-tight">
      <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-brand text-brand-ink">
        <svg viewBox="0 0 32 32" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M8 10h16M8 16h16M8 22h9" />
        </svg>
      </span>
      Blog Admin
    </Link>
  );
}

function ThemeMenu() {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = preference === "system" ? LuMonitor : resolved === "dark" ? LuMoon : LuSun;
  return (
    <DropdownMenu
      label="Theme"
      triggerClassName="grid size-10 place-items-center rounded-ctl text-ink hover:bg-panel-2 pointer-coarse:size-11"
      trigger={<Icon aria-hidden className="size-[1.125rem]" />}
      items={[
        { id: "light", label: "Light", icon: <LuSun className="size-4" />, checked: preference === "light", onSelect: () => setPreference("light") },
        { id: "dark", label: "Dark", icon: <LuMoon className="size-4" />, checked: preference === "dark", onSelect: () => setPreference("dark") },
        { id: "system", label: "System", icon: <LuMonitor className="size-4" />, checked: preference === "system", onSelect: () => setPreference("system") },
      ]}
    />
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "A"
  );
}

function UserMenu({ me }: { me: Me }) {
  const toast = useToast();
  async function signOut() {
    try {
      await authClient.signOut();
    } catch {
      toast.error("Could not sign out cleanly. Redirecting…");
    }
    window.location.assign(withBase("/login"));
  }
  return (
    <DropdownMenu
      label={`Account menu for ${me.name}`}
      triggerClassName="flex min-h-10 items-center gap-2 rounded-ctl px-1.5 text-sm hover:bg-panel-2 pointer-coarse:min-h-11"
      header={
        <div className="min-w-0">
          <p className="truncate font-medium">{me.name}</p>
          <p className="truncate text-[0.8125rem] text-muted">{me.email}</p>
        </div>
      }
      trigger={
        <>
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
            {initials(me.name)}
          </span>
          <span className="hidden max-w-32 truncate font-medium sm:block">{me.name}</span>
          <LuChevronDown aria-hidden className="hidden size-4 text-muted sm:block" />
        </>
      }
      items={[
        { id: "site", label: "View public site", icon: <LuExternalLink className="size-4" />, href: SITE_URL || "/", external: true },
        { id: "out", label: "Sign out", icon: <LuLogOut className="size-4" />, onSelect: signOut, separatorBefore: true },
      ]}
    />
  );
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    // Close the mobile drawer after navigating.
    const t = window.setTimeout(() => setDrawer(false), 0);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-ctl focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-brand-ink"
      >
        Skip to main content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-edge bg-panel px-3 py-4 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <SidebarNav label="Main" />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-edge bg-panel px-3 sm:px-5">
          <div className="lg:hidden">
            <IconButton label="Open navigation menu" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <LuMenu aria-hidden className="size-5" />
            </IconButton>
          </div>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeMenu />
            <UserMenu me={me} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>

      <Dialog open={drawer} onClose={() => setDrawer(false)} title="Navigation" hideTitle drawer>
        <SidebarNav label="Main (mobile)" />
      </Dialog>
    </div>
  );
}
