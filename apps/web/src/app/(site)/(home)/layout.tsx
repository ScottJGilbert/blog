import { SiteShell } from "@/components/layout/SiteShell";

export default function HomeSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell section="home">
      {children}
    </SiteShell>
  );
}
