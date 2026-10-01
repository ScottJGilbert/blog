import { clsx } from "clsx";
import type { ReactNode } from "react";
import Footer from "@/components/site/Footer";
import Navbar from "@/components/site/Navbar";
import SkipLink from "@/components/site/SkipLink";
import type { SectionId } from "@/lib/site";

/**
 * Page chrome for a themed section: skip link, header, <main id="main">, footer.
 * `data-section` scopes the semantic CSS variables, so header and footer adopt
 * the section theme automatically. It is exactly one viewport tall at minimum
 * (dvh) and the footer is pushed to the bottom with flex, so nothing shifts.
 *
 * Section layouts pass `className` to attach their next/font variables.
 */
export function SiteShell({
  section,
  className,
  children,
}: {
  section: SectionId;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-section={section}
      className={clsx(
        "flex min-h-dvh flex-col bg-bg font-sans text-fg",
        className,
      )}
    >
      <SkipLink />
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
