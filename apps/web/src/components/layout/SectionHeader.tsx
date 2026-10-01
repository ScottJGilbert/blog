import { clsx } from "clsx";
import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Buttons / links rendered under the description. */
  actions?: ReactNode;
  /** `h1` for the page title (exactly one per page), `h2` for sub-sections. */
  as?: "h1" | "h2";
  /** `hero` is the large fluid display size used on the home page. */
  size?: "default" | "hero";
  align?: "left" | "center";
  /** Paint the section's decorative motif behind the header. */
  motif?: boolean;
  className?: string;
  id?: string;
}

/** Page/section heading block shared by all three themes. */
export function SectionHeader({
  title,
  eyebrow,
  description,
  actions,
  as: Heading = "h1",
  size = "default",
  align = "left",
  motif = false,
  className,
  id,
}: SectionHeaderProps) {
  const centered = align === "center";
  return (
    <header
      className={clsx(
        motif && "section-motif",
        centered && "text-center",
        className,
      )}
    >
      {eyebrow && <p className="eyebrow mb-3 text-accent">{eyebrow}</p>}
      <Heading
        id={id}
        className={clsx(
          "text-fg",
          size === "hero" ? "text-display" : "text-h1",
        )}
      >
        {title}
      </Heading>
      {description && (
        <p
          className={clsx(
            "mt-4 max-w-2xl text-base text-muted sm:text-lg",
            centered && "mx-auto",
            size === "hero" && "mt-6 sm:text-xl",
          )}
        >
          {description}
        </p>
      )}
      {actions && (
        <div
          className={clsx(
            "mt-8 flex flex-wrap gap-3",
            centered && "justify-center",
          )}
        >
          {actions}
        </div>
      )}
    </header>
  );
}
