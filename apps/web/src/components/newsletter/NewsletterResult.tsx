import type { ReactNode } from "react";
import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { ButtonLink } from "@/components/ui/Button";

/** Full-page outcome of an emailed newsletter link (confirm / unsubscribe). */
export function NewsletterResult({
  ok,
  title,
  children,
  retryHref,
}: {
  ok: boolean;
  title: string;
  children: ReactNode;
  retryHref?: string;
}) {
  const Icon = ok ? LuCircleCheck : LuCircleAlert;
  return (
    <div className="section-motif">
      <PageContainer size="prose" className="py-16 text-center sm:py-24">
        <div
          aria-hidden
          className={`mx-auto mb-6 flex size-16 items-center justify-center rounded-card text-3xl ${
            ok ? "bg-accent-soft text-accent-soft-fg" : "bg-surface-2 text-danger"
          }`}
        >
          <Icon />
        </div>
        <h1 className="text-h1 text-fg">{title}</h1>
        <div role={ok ? "status" : "alert"} className="mx-auto mt-4 max-w-md text-lg text-muted">
          {children}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/" size="lg">
            Back to the blog
          </ButtonLink>
          {retryHref && (
            <ButtonLink href={retryHref} variant="secondary" size="lg">
              Subscribe again
            </ButtonLink>
          )}
        </div>
      </PageContainer>
    </div>
  );
}
