export const SITE_NAME = "Scott Gilbert";
export const SITE_DOMAIN = "blog.scottgilbert.dev";
export const SITE_DESCRIPTION =
  "Writing by Scott Gilbert, a computer engineer: personal reflections, engineering insights from the field, and a cookbook of recipes.";

export type SectionId = "home" | "personal" | "engineering" | "cookbook";

export interface SectionInfo {
  id: SectionId;
  label: string;
  href: string;
}

/** Primary navigation, in display order. */
export const SECTIONS: readonly SectionInfo[] = [
  { id: "home", label: "Home", href: "/" },
  { id: "personal", label: "Personal", href: "/personal" },
  { id: "engineering", label: "Engineering", href: "/engineering" },
  { id: "cookbook", label: "Cookbook", href: "/cookbook" },
];

/** True when `pathname` is `href` or a nested route below it (home is exact). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
