"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LuMenu, LuSearch, LuX } from "react-icons/lu";
import { AccountLink } from "@/components/auth/AccountLink";
import { PageContainer } from "@/components/layout/PageContainer";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SECTIONS, SITE_DOMAIN, isActivePath } from "@/lib/site";

const NAV_LIST_ID = "primary-nav-list";

/**
 * Sticky site header (reserves its own 4rem of space, never overlaps content).
 *  - >= md: brand, inline links, theme toggle.
 *  - <  md: brand, theme toggle and a disclosure button that reveals the links
 *    in a panel below the header. Escape / outside click / focus leaving /
 *    route change all close it; Escape returns focus to the button.
 * It inherits colours and fonts from the surrounding [data-section] theme.
 */
export default function Navbar() {
  const pathname = usePathname();
  // Remember the path the menu was opened on: navigating elsewhere closes it
  // without needing an effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;

  const headerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setOpenPath(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/85"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpenPath(null);
          buttonRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        // Keyboard users tabbing out of the open panel close it.
        if (open && !headerRef.current?.contains(event.relatedTarget)) {
          setOpenPath(null);
        }
      }}
    >
      <PageContainer
        size="wide"
        className="flex h-(--spacing-header) items-center justify-between gap-2"
      >
        <Link
          prefetch={false}
          href="/"
          aria-label={`${SITE_DOMAIN}, home`}
          className="inline-flex min-h-11 min-w-0 items-center truncate font-display text-[0.9375rem] font-extrabold tracking-tight text-accent sm:text-xl"
        >
          {SITE_DOMAIN}
        </Link>

        <div className="flex items-center gap-1">
          <nav aria-label="Primary">
            <ul
              id={NAV_LIST_ID}
              className={clsx(
                "absolute inset-x-0 top-full flex-col gap-1 border-b border-border bg-bg p-3 shadow-card",
                "md:static md:flex md:flex-row md:border-0 md:bg-transparent md:p-0 md:shadow-none",
                open ? "flex" : "hidden",
              )}
            >
              {SECTIONS.map((link) => (
                <li key={link.id}>
                  <Link
                    prefetch={false}
                    href={link.href}
                    aria-current={
                      isActivePath(pathname, link.href) ? "page" : undefined
                    }
                    className="flex min-h-11 items-center rounded-full px-4 text-base font-semibold text-fg transition-colors hover:bg-surface-2 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-fg md:text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {/* Account lives in the menu panel below md; md+ shows it as the header pill next to the toggle. */}
              <li className="md:hidden">
                <Link
                  prefetch={false}
                  href="/search"
                  aria-current={pathname === "/search" ? "page" : undefined}
                  className="flex min-h-11 items-center gap-2 rounded-full px-4 text-base font-semibold text-fg transition-colors hover:bg-surface-2 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-fg"
                >
                  <LuSearch aria-hidden className="size-5" />
                  Search
                </Link>
              </li>
              <li className="md:hidden">
                <AccountLink variant="menu" />
              </li>
            </ul>
          </nav>

          <Link
            prefetch={false}
            href="/search"
            aria-label="Search"
            aria-current={pathname === "/search" ? "page" : undefined}
            className="hidden size-11 shrink-0 items-center justify-center rounded-full text-fg transition-colors hover:bg-surface-2 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-fg md:inline-flex"
          >
            <LuSearch aria-hidden className="size-5" />
          </Link>
          <AccountLink variant="header" />
          <ThemeToggle />

          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={NAV_LIST_ID}
            aria-label="Menu"
            onClick={() => setOpenPath(open ? null : pathname)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg transition-colors hover:bg-surface-2 md:hidden"
          >
            {open ? (
              <LuX aria-hidden className="size-6" />
            ) : (
              <LuMenu aria-hidden className="size-6" />
            )}
          </button>
        </div>
      </PageContainer>
    </header>
  );
}
