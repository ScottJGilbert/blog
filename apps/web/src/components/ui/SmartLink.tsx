import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { LuArrowUpRight } from "react-icons/lu";

export const isExternalHref = (href: string) =>
  /^(https?:)?\/\//.test(href) || href.startsWith("mailto:");

type SmartLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
  /** Show the small north-east arrow on external links (default true). */
  showExternalIcon?: boolean;
};

/**
 * Internal hrefs render a next/link; external ones render a plain anchor that
 * opens in a new tab with a screen-reader hint and the noopener guarantees.
 */
export function SmartLink({
  href,
  children,
  showExternalIcon = true,
  ...rest
}: SmartLinkProps) {
  if (!isExternalHref(href)) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  const isMail = href.startsWith("mailto:");
  return (
    <a
      href={href}
      {...(isMail ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      {...rest}
    >
      {children}
      {!isMail && (
        <>
          {showExternalIcon && (
            <LuArrowUpRight aria-hidden className="size-4 shrink-0" />
          )}
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      )}
    </a>
  );
}
