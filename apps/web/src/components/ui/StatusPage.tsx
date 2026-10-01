import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";

/** Centered full-page message used by not-found and error boundaries. */
export function StatusPage({
  code,
  title,
  description,
  children,
}: {
  code?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <PageContainer
      size="prose"
      className="section-motif py-20 text-center sm:py-28"
    >
      {code && <p className="eyebrow mb-3 text-accent">{code}</p>}
      <h1 className="text-h1 text-fg">{title}</h1>
      <p className="mx-auto mt-4 max-w-md text-lg text-muted">{description}</p>
      {children && (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {children}
        </div>
      )}
    </PageContainer>
  );
}
