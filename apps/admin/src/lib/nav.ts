import type { IconType } from "react-icons";
import {
  LuFileText,
  LuImage,
  LuKey,
  LuLayoutDashboard,
  LuMail,
  LuMessageSquare,
  LuNewspaper,
  LuSettings,
  LuUsers,
} from "react-icons/lu";

export interface NavItem {
  href: string;
  label: string;
  icon: IconType;
}
export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: null, items: [{ href: "/", label: "Dashboard", icon: LuLayoutDashboard }] },
  {
    label: "Content",
    items: [
      { href: "/posts", label: "Posts", icon: LuFileText },
      { href: "/media", label: "Media", icon: LuImage },
      { href: "/comments", label: "Comments", icon: LuMessageSquare },
    ],
  },
  {
    label: "Audience",
    items: [
      { href: "/users", label: "Users", icon: LuUsers },
      { href: "/subscribers", label: "Subscribers", icon: LuMail },
      { href: "/newsletters", label: "Newsletters", icon: LuNewspaper },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/api-keys", label: "API keys", icon: LuKey },
      { href: "/settings", label: "Settings", icon: LuSettings },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
