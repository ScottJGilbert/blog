"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive } from "@/lib/nav";
import { cn } from "@/components/ui/cn";

export function SidebarNav({ label = "Main" }: { label?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="space-y-5">
      {NAV.map((group, gi) => (
        <div key={gi}>
          {group.label ? (
            <p className="mb-1.5 px-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">{group.label}</p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium pointer-coarse:min-h-11",
                      active ? "bg-brand-soft text-brand" : "text-ink/85 hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <item.icon aria-hidden className="size-[1.125rem] shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
