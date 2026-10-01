import { SiteShell } from "@/components/layout/SiteShell";

export default function EngineeringSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell section="engineering">
      {children}
    </SiteShell>
  );
}
