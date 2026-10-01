import { SiteShell } from "@/components/layout/SiteShell";
import { fraunces } from "@/lib/fonts/fraunces";

export default function PersonalSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell section="personal" className={fraunces.variable}>
      {children}
    </SiteShell>
  );
}
