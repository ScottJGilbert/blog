import { SiteShell } from "@/components/layout/SiteShell";

export default function CookbookSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SiteShell section="cookbook">{children}</SiteShell>;
}
