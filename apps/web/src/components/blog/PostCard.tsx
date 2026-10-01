import Image from "next/image";
import Link from "next/link";
import { clsx } from "clsx";
import { LuClock } from "react-icons/lu";
import { Tag } from "@/components/ui/Tag";
import type { SectionId } from "@/lib/site";

export interface PostCardTag {
  label: string;
  /** Optional filter link, e.g. `/engineering?tag=cad`. */
  href?: string;
}

export interface PostCardProps {
  title: string;
  /** Link to the post. The whole card is clickable via a stretched link. */
  href: string;
  excerpt?: string | null;
  cover?: {
    src: string;
    /** Empty string marks the image as purely decorative. */
    alt: string;
    /** Intrinsic size, used only to infer the aspect ratio; defaults 1200x675. */
    width?: number;
    height?: number;
  } | null;
  tags?: PostCardTag[];
  /** ISO string or Date. Rendered as <time> in UTC so SSR/CSR always agree. */
  publishedAt?: string | Date | null;
  readingMinutes?: number | null;
  /** Force a section theme for this card (cards inherit the page theme by default). */
  section?: SectionId;
  /** `horizontal` puts the cover beside the text from `md` up. */
  layout?: "vertical" | "horizontal";
  /** Heading level of the title (default h2; use h3 under a section heading). */
  headingLevel?: "h2" | "h3";
  /** Preload the cover. Use ONLY for the single likely-LCP card above the fold. */
  priority?: boolean;
  /** `sizes` hint for the cover; override if the card sits in a different grid. */
  sizes?: string;
  className?: string;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/**
 * Presentational post teaser (no data fetching). The cover box has a fixed
 * aspect ratio so image loading never shifts the layout.
 */
export function PostCard({
  title,
  href,
  excerpt,
  cover,
  tags = [],
  publishedAt,
  readingMinutes,
  section,
  layout = "vertical",
  headingLevel: Heading = "h2",
  priority = false,
  sizes,
  className,
}: PostCardProps) {
  const date = publishedAt ? new Date(publishedAt) : null;
  const horizontal = layout === "horizontal";

  return (
    <article
      data-section={section}
      className={clsx(
        "group card-lift relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface text-fg shadow-card has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
        horizontal && "md:flex-row",
        className,
      )}
    >
      {cover && (
        <div
          className={clsx(
            "relative aspect-video w-full shrink-0 overflow-hidden bg-surface-2",
            horizontal && "md:aspect-auto md:min-h-full md:w-2/5",
          )}
        >
          <Image
            src={cover.src}
            alt={cover.alt}
            width={cover.width ?? 1200}
            height={cover.height ?? 675}
            sizes={
              sizes ??
              (horizontal
                ? "(min-width: 768px) 320px, 100vw"
                : "(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw")
            }
            preload={priority}
            className="size-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.03]"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
        {(date || readingMinutes) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-accent text-sm text-muted">
            {date && (
              <time dateTime={date.toISOString()}>
                {dateFormat.format(date)}
              </time>
            )}
            {readingMinutes ? (
              <span className="inline-flex items-center gap-1">
                <LuClock aria-hidden className="size-4" />
                {readingMinutes} min read
              </span>
            ) : null}
          </p>
        )}

        <Heading className="text-xl text-fg sm:text-2xl">
          {/* Stretched link: ::after covers the whole card. */}
          <Link
            href={href}
            className="rounded-none after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {title}
          </Link>
        </Heading>

        {excerpt && <p className="line-clamp-3 text-muted">{excerpt}</p>}

        {tags.length > 0 && (
          <ul
            aria-label="Tags"
            className="relative z-10 mt-auto flex flex-wrap gap-2 pt-2"
          >
            {tags.map((tag) => (
              <li key={tag.label}>
                <Tag href={tag.href}>{tag.label}</Tag>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/** Same outer dimensions as PostCard; use in loading.tsx. */
export function PostCardSkeleton({
  layout = "vertical",
  withCover = true,
  className,
}: {
  layout?: "vertical" | "horizontal";
  withCover?: boolean;
  className?: string;
}) {
  const horizontal = layout === "horizontal";
  return (
    <div
      aria-hidden
      className={clsx(
        "flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface",
        horizontal && "md:flex-row",
        className,
      )}
    >
      {withCover && (
        <div
          className={clsx(
            "aspect-video w-full shrink-0 bg-surface-2 motion-safe:animate-pulse",
            horizontal && "md:aspect-auto md:min-h-full md:w-2/5",
          )}
        />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
        <div className="h-5 w-1/3 rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-8 w-4/5 rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-[4.5rem] w-full rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="mt-auto h-6 w-1/2 rounded-full bg-surface-2 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
