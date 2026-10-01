import { SiteShell } from "@/components/layout/SiteShell";

export default function PersonalSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell section="personal">
      {children}
    </SiteShell>
  );
}
