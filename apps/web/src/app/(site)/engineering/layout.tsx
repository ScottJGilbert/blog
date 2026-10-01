import { SiteShell } from "@/components/layout/SiteShell";
import { jetbrainsMono } from "@/lib/fonts/jetbrainsMono";

export default function EngineeringSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell section="engineering" className={jetbrainsMono.variable}>
      {children}
    </SiteShell>
  );
}
