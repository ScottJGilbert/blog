import Image from "next/image";
import Link from "next/link";
import { clsx } from "clsx";
import type { PostSummary } from "@blog/shared";
import { LuChefHat } from "react-icons/lu";
import { Tag } from "@/components/ui/Tag";
import { imageSource } from "@/lib/media-hosts";
import { listingHref, postHref } from "@/lib/paths";

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Index-card style teaser for the cookbook. Deliberately unlike a blog PostCard: a numbered entry (as in a book's
 * contents), a 4:3 photo, the recipe name in the display face, the one-line headnote, and "courses" (tags). No author,
 * no reading time. Same whole-card stretched-link pattern as PostCard.
 */
export function RecipeCard({
  recipe,
  number,
  priority = false,
}: {
  recipe: PostSummary;
  /** 1-based position in the book (continues across pages). */
  number: number;
  priority?: boolean;
}) {
  const cover = recipe.coverImageUrl ? imageSource(recipe.coverImageUrl) : null;
  return (
    <article
      data-section="cookbook"
      className="group card-lift relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface text-fg shadow-card has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-surface-2">
        {cover?.src ? (
          <Image
            src={cover.src}
            alt={recipe.coverImageAlt ?? ""}
            width={800}
            height={600}
            sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
            preload={priority}
            fetchPriority={priority ? "high" : undefined}
            unoptimized={cover.unoptimized}
            className="size-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.03]"
          />
        ) : (
          <div aria-hidden className="section-motif flex size-full items-center justify-center">
            <LuChefHat className="size-12 text-accent opacity-40" />
          </div>
        )}
        <span
          aria-hidden
          className="absolute top-3 left-3 rounded-full bg-surface px-3 py-1 font-accent text-[0.8125rem] font-bold tabular-nums text-accent shadow-card"
        >
          № {String(number).padStart(2, "0")}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <h2 className="text-xl text-fg sm:text-2xl">
          <Link
            prefetch={false}
            href={postHref("cookbook", recipe.slug)}
            className="rounded-none after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {recipe.title}
          </Link>
        </h2>
        {recipe.excerpt && <p className="line-clamp-2 text-sm text-muted">{recipe.excerpt}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
          {recipe.publishedAt && (
            <p className="font-accent text-sm text-muted">
              Cooked <time dateTime={recipe.publishedAt}>{monthYear.format(new Date(recipe.publishedAt))}</time>
            </p>
          )}
          {recipe.tags.length > 0 && (
            <ul aria-label="Courses" className="relative z-10 flex flex-wrap gap-2">
              {recipe.tags.map((t) => (
                <li key={t.slug}>
                  <Tag href={listingHref("/cookbook", { tag: t.slug })}>{t.name}</Tag>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

/** Same outer dimensions as RecipeCard; used by the listing's loading.tsx. */
export function RecipeCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx("flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface", className)}
    >
      <div className="aspect-[4/3] w-full shrink-0 bg-surface-2 motion-safe:animate-pulse" />
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="h-8 w-4/5 rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-10 w-full rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="mt-auto h-6 w-1/2 rounded-full bg-surface-2 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
