import Image from "next/image";
import Link from "next/link";
import type { PostDetail } from "@blog/shared";
import { LuCalendar, LuClock, LuRefreshCw } from "react-icons/lu";
import { Tag } from "@/components/ui/Tag";
import { formatDate } from "@/lib/format";
import { imageSource } from "@/lib/media-hosts";
import { listingHref, SECTION_LABEL } from "@/lib/paths";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function PostHeader({ post }: { post: PostDetail }) {
  const cover = post.coverImageUrl ? imageSource(post.coverImageUrl) : null;
  const updated = new Date(post.updatedAt).getTime() - new Date(post.publishedAt).getTime() > 24 * 3600 * 1000;
  return (
    <header>
      <p className="eyebrow mb-4 text-accent">
        <Link href={`/${post.section}`} className="underline-offset-4 hover:underline">
          {SECTION_LABEL[post.section]}
        </Link>
      </p>
      <h1 className="text-h1 text-fg">{post.title}</h1>
      {post.excerpt && <p className="mt-4 text-lg text-muted sm:text-xl">{post.excerpt}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          {post.author.image ? (
            <Image src={post.author.image} alt="" width={32} height={32} className="size-8 rounded-full" unoptimized />
          ) : (
            <span
              aria-hidden
              className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-soft-fg"
            >
              {initials(post.author.name)}
            </span>
          )}
          <span>
            <span className="sr-only">Written by </span>
            <span className="font-semibold text-fg">{post.author.name}</span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 font-accent">
          <LuCalendar aria-hidden className="size-4" />
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
        </span>
        <span className="inline-flex items-center gap-1.5 font-accent">
          <LuClock aria-hidden className="size-4" />
          {post.readingMinutes} min read
        </span>
        {updated && (
          <span className="inline-flex items-center gap-1.5 font-accent">
            <LuRefreshCw aria-hidden className="size-4" />
            Updated <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time>
          </span>
        )}
      </div>

      {post.tags.length > 0 && (
        <ul aria-label="Tags" className="mt-5 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <li key={tag.slug}>
              <Tag href={listingHref(`/${post.section}`, { tag: tag.slug })}>{tag.name}</Tag>
            </li>
          ))}
        </ul>
      )}

      {cover?.src && (
        <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-card border border-border bg-surface-2">
          <Image
            src={cover.src}
            alt={post.coverImageAlt ?? ""}
            width={1600}
            height={900}
            sizes="(min-width: 1280px) 704px, (min-width: 768px) 720px, 100vw"
            preload
            unoptimized={cover.unoptimized}
            className="size-full object-cover"
          />
        </div>
      )}
    </header>
  );
}
