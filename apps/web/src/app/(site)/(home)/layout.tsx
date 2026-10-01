import { SiteShell } from "@/components/layout/SiteShell";
import { epilogue } from "@/lib/fonts/epilogue";

export default function HomeSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell section="home" className={epilogue.variable}>
      {children}
    </SiteShell>
  );
}
