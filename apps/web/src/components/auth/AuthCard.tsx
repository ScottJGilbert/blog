import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";

/** Centered card used by every auth page. One h1 per page (the title). */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="section-motif">
      <PageContainer size="prose" className="py-12 sm:py-16">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-h1 text-fg">{title}</h1>
          {description && <p className="mt-3 text-lg text-muted">{description}</p>}
          <div className="mt-8 rounded-card border border-border bg-surface p-5 shadow-card sm:p-7">{children}</div>
          {footer && <div className="mt-6 text-center text-muted">{footer}</div>}
        </div>
      </PageContainer>
    </div>
  );
}

export const linkClass = "font-semibold text-accent underline underline-offset-4";
