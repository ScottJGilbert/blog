import { clsx } from "clsx";
import type { ElementType, ReactNode } from "react";

const sizes = {
  /** Reading column (articles, about). */
  prose: "max-w-reading",
  /** Default page width (listings). */
  page: "max-w-page",
  /** Header/footer and wide grids. */
  wide: "max-w-wide",
} as const;

export type PageContainerSize = keyof typeof sizes;

/**
 * The single horizontal container used by header, footer and every page.
 * Pages must NOT add their own max-width / horizontal padding on top of it.
 */
export function PageContainer({
  size = "page",
  as: Tag = "div",
  className,
  children,
}: {
  size?: PageContainerSize;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={clsx(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        sizes[size],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
