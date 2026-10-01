import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { LuChevronRight } from "react-icons/lu";

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumbs + the page's single `<h1>` + optional actions. Reserves its height so nothing shifts when data loads. */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  titleSuffix,
}: {
  title: string;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  titleSuffix?: ReactNode;
}) {
  const all: Crumb[] = [{ label: "Dashboard", href: "/" }, ...(crumbs ?? [])];
  return (
    <header className="mb-5 space-y-2">
      {crumbs ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-[0.8125rem] text-muted">
            {all.map((c, i) => {
              const last = i === all.length - 1;
              return (
                <Fragment key={`${c.label}-${i}`}>
                  <li className="flex items-center gap-1">
                    {c.href && !last ? (
                      <Link href={c.href} className="rounded px-0.5 py-1 hover:text-ink hover:underline">
                        {c.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-ink" : undefined}>
                        {c.label}
                      </span>
                    )}
                  </li>
                  {!last ? (
                    <li aria-hidden className="flex items-center">
                      <LuChevronRight className="size-3.5" />
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {title}
            {titleSuffix}
          </h1>
          {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Card surface used by every page section. */
export function Card({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`rounded-xl border border-edge bg-panel ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
