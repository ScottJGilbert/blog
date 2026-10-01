import Link from "next/link";

interface NavigationGroup {
  title: { label: string; href: string | null };
  links: { label: string; href: string }[];
}

const navigationGroups: NavigationGroup[] = [
  {
    title: {
      label: "Home",
      href: "/",
    },
    links: [
      { label: "Home", href: "/" },
      { label: "About", href: "/about" },
      { label: "Legal", href: "/legal" },
    ],
  },
  {
    title: {
      label: "External",
      href: null,
    },
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
    title: {
      label: "Miscellaneous",
      href: null,
    },
    links: [
      { label: "RSS Feed", href: "/rss.xml" },
      { label: "Sitemap", href: "/sitemap.xml" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="w-full tonal-layering pt-24 px-8">
      <div className="max-w-7xl mx-auto">
        {/* <!-- Main Footer Grid --> */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 pb-16">
          {/* <!-- Left Column: Branding & Newsletter --> */}
          <div className="md:col-span-5 space-y-12">
            <div className="space-y-6">
              <div className="font-display-lg text-headline-md text-primary dark:text-primary-fixed-dim tracking-tighter">
                blog.scottgilbert.dev
              </div>
            </div>
            <div className="space-y-4">
              <p className="font-label-md text-label-md text-on-surface uppercase tracking-widest">
                Stay in the loop:
              </p>
              <div className="flex gap-2 max-w-sm">
                <input
                  className="flex-1 bg-surface-container-high/50 dark:bg-surface-container-highest/10 border-none rounded-lg px-4 py-3 font-body-md focus:ring-2 focus:ring-primary/20 text-on-surface"
                  placeholder="Email address"
                  type="email"
                />
                <button className="bg-primary-container dark:bg-primary-fixed text-on-primary dark:text-on-primary-fixed px-6 py-3 rounded-lg font-label-md hover:bg-primary transition-all">
                  SIGNUP
                </button>
              </div>
            </div>
          </div>

          {/* <!-- Right Column: Navigation Links --> */}
          <div className="md:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-8 justify-items-start">
            {navigationGroups.map((group) => (
              <div
                className="flex flex-col gap-6 items-start"
                key={group.title.label}
              >
                {group.title.href ? (
                  <Link
                    href={group.title.href}
                    className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest"
                  >
                    {group.title.label}
                  </Link>
                ) : (
                  <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">
                    {group.title.label}
                  </p>
                )}
                <nav className="flex flex-col gap-3 items-start">
                  {group.links.map((link) => (
                    <Link
                      className="font-body-md text-body-md text-on-surface-variant dark:text-on-surface-variant hover:text-primary transition-colors"
                      href={link.href}
                      key={link.label}
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </div>
            ))}
          </div>
        </div>

        {/* <!-- Footer Bottom --> */}
        <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-outline-variant/5 gap-4">
          <p className="font-body-md text-body-md text-on-surface-variant opacity-60">
            © 2026 Scott Gilbert. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
