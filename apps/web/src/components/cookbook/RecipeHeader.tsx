import Image from "next/image";
import Link from "next/link";
import type { PostDetail } from "@blog/shared";
import { LuCalendar, LuRefreshCw } from "react-icons/lu";
import { Tag } from "@/components/ui/Tag";
import { formatDate } from "@/lib/format";
import { imageSource } from "@/lib/media-hosts";
import { listingHref } from "@/lib/paths";
import { PrintButton } from "./PrintButton";

/**
 * Title block of a recipe page. Where a blog post leads with byline and reading time, a recipe leads with its name,
 * the one-line headnote (the excerpt: yield and timings go here), when it was cooked, and a print button.
 */
export function RecipeHeader({ post }: { post: PostDetail }) {
  const cover = post.coverImageUrl ? imageSource(post.coverImageUrl) : null;
  const updated = new Date(post.updatedAt).getTime() - new Date(post.publishedAt).getTime() > 24 * 3600 * 1000;
  return (
    <header>
      <p className="eyebrow mb-4 text-accent">
        <Link prefetch={false} href="/cookbook" className="underline-offset-4 hover:underline">
          <span aria-hidden>← </span>The Cookbook
        </Link>
      </p>
      <h1 className="text-h1 text-fg">{post.title}</h1>
      {post.excerpt && (
        <p className="mt-4 border-y border-border py-3 font-accent text-base font-semibold text-fg sm:text-lg">{post.excerpt}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <p className="flex flex-wrap items-center gap-x-5 gap-y-2 font-accent text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <LuCalendar aria-hidden className="size-4" />
            Cooked <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          </span>
          {updated && (
            <span className="inline-flex items-center gap-1.5">
              <LuRefreshCw aria-hidden className="size-4" />
              Revised <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time>
            </span>
          )}
        </p>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </div>

      {post.tags.length > 0 && (
        <ul aria-label="Courses" className="mt-4 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <li key={tag.slug}>
              <Tag href={listingHref("/cookbook", { tag: tag.slug })}>{tag.name}</Tag>
            </li>
          ))}
        </ul>
      )}

      {cover?.src && (
        <div className="relative mt-8 aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface-2 print:max-h-64">
          <Image
            src={cover.src}
            alt={post.coverImageAlt ?? ""}
            width={1600}
            height={1200}
            sizes="(min-width: 768px) 768px, 100vw"
            preload
            fetchPriority="high"
            unoptimized={cover.unoptimized}
            className="size-full object-cover"
          />
        </div>
      )}
    </header>
  );
}
