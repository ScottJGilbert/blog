import Link from "next/link";
import { LuRss } from "react-icons/lu";
import { FooterNewsletter } from "@/components/newsletter/FooterNewsletter";
import { PageContainer } from "@/components/layout/PageContainer";
import { SmartLink } from "@/components/ui/SmartLink";
import { SITE_DOMAIN, SITE_NAME } from "@/lib/site";

interface FooterGroup {
  title: string;
  links: { label: string; href: string; /** plain <a>: not a page (feeds, sitemaps) */ native?: boolean }[];
}

const FOOTER_GROUPS: FooterGroup[] = [
  {
    title: "Explore",
    links: [
      { label: "Home", href: "/" },
      { label: "Personal", href: "/personal" },
      { label: "Engineering", href: "/engineering" },
      { label: "About", href: "/about" },
      { label: "Search", href: "/search" },
    ],
  },
  {
    title: "Elsewhere",
    links: [
      {
        label: "LinkedIn",
        href: "https://www.linkedin.com/in/scott-j-gilbert",
      },
      { label: "GitHub", href: "https://github.com/ScottJGilbert" },
      { label: "Portfolio", href: "https://scottgilbert.dev" },
      { label: "Miracle Makers", href: "https://miracles.scottgilbert.dev" },
    ],
  },
  {
    title: "Site",
    links: [
      { label: "RSS feed", href: "/feed.xml", native: true },
      { label: "Sitemap", href: "/sitemap.xml", native: true },
      { label: "Account", href: "/account" },
    ],
  },
];

const linkClass =
  "inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-muted underline-offset-4 transition-colors hover:text-accent hover:underline";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-surface-2/40">
      <PageContainer size="wide" className="py-12 sm:py-16">
        <div className="max-w-2xl">
          <FooterNewsletter />
        </div>
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center font-display text-xl font-extrabold tracking-tight text-accent"
            >
              {SITE_DOMAIN}
            </Link>
            <p className="mt-3 max-w-sm text-muted">
              Notes on engineering, making, and life from {SITE_NAME}.
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:col-span-7"
          >
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="eyebrow text-fg">{group.title}</h2>
                <ul className="mt-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      {link.native ? (
                        <a href={link.href} className={linkClass}>
                          {link.href === "/feed.xml" && <LuRss aria-hidden className="size-4" />}
                          {link.label}
                        </a>
                      ) : (
                        <SmartLink href={link.href} className={linkClass}>
                          {link.label}
                        </SmartLink>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className="mt-10 border-t border-border pt-6 text-sm text-muted">
          &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
        </p>
      </PageContainer>
    </footer>
  );
}
