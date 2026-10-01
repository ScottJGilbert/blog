import type { Metadata } from "next";
import { SiteShell } from "@/components/layout/SiteShell";
import { ButtonLink } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <SiteShell section="home">
      <StatusPage
        code="404"
        title="Page not found"
        description="The page you’re looking for doesn’t exist or has moved."
      >
        <ButtonLink href="/" size="lg">
          Back to home
        </ButtonLink>
        <ButtonLink href="/engineering" variant="secondary" size="lg">
          Browse engineering
        </ButtonLink>
      </StatusPage>
    </SiteShell>
  );
}
