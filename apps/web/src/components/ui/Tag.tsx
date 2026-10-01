import { clsx } from "clsx";
import type { ReactNode } from "react";
import { SmartLink } from "./SmartLink";

const styles =
  "inline-flex min-h-6 items-center rounded-full bg-accent-soft px-3 py-0.5 text-[0.8125rem] font-semibold leading-5 text-accent-soft-fg";

/** Small pill used for tags and status chips. Pass `href` to make it a link. */
export function Tag({
  children,
  href,
  className,
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  if (href) {
    return (
      <SmartLink
        href={href}
        className={clsx(
          styles,
          "transition-colors hover:bg-accent hover:text-accent-fg",
          className,
        )}
      >
        {children}
      </SmartLink>
    );
  }
  return <span className={clsx(styles, className)}>{children}</span>;
}
