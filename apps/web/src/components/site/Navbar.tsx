"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FaSun, FaMoon } from "react-icons/fa";
import { clsx } from "clsx";
import Link from "next/link";
import { ThemeToggle } from "../ui/ThemeToggle";

const blogLinks = [
  { label: "Home", href: "/" },
  { label: "Personal", href: "/personal" },
  { label: "Engineering", href: "/engineering" },
];

export default function Navbar() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  const setLight = () => {
    document.documentElement.classList.remove("dark");
    setIsDarkMode(false);
  };
  const setDark = () => {
    document.documentElement.classList.add("dark");
    setIsDarkMode(true);
  };

  const pathname = usePathname();
  const activeLink = blogLinks.find((link) => link.href === pathname);

  return (
    <nav className="pointer-events-none fixed left-0 right-0 top-8 z-50 flex justify-center px-8">
      <div className="flex w-full max-w-7xl items-center justify-between">
        {/* Brand */}
        <div className="pointer-events-auto">
          <Link
            href="/"
            className="font-display-lg text-headline-md tracking-tighter text-primary dark:text-primary-fixed-dim"
          >
            blog.scottgilbert.dev
          </Link>
        </div>

        {/* Consolidated switcher pill */}
        <div className="glass-effect pointer-events-auto flex items-center gap-1 rounded-full bg-surface/80 px-2 py-1.5 shadow-lg dark:bg-dark-background/80">
          <div className="flex items-center gap-1 px-3">
            {blogLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={
                  activeLink?.href === link.href
                    ? "rounded-full bg-primary/5 px-3 py-1.5 font-label-md text-label-md font-bold text-primary dark:bg-primary-fixed/10 dark:text-primary-fixed-dim"
                    : "px-3 py-1.5 font-label-md text-label-md text-on-surface-variant transition-colors hover:text-primary dark:hover:text-primary-fixed-dim"
                }
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="mx-1 h-6 w-px bg-outline-variant/20" />

          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
