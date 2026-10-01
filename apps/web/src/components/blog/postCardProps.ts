import type { PostSummary } from "@blog/shared";
import { imageSource } from "@/lib/media-hosts";
import { listingHref, postHref } from "@/lib/paths";
import type { PostCardProps } from "./PostCard";

/** Map an API PostSummary to PostCard props (cards preview their own section theme). */
export function toCardProps(post: PostSummary): PostCardProps {
  const cover = post.coverImageUrl ? imageSource(post.coverImageUrl) : null;
  return {
    title: post.title,
    href: postHref(post.section, post.slug),
    excerpt: post.excerpt,
    section: post.section,
    publishedAt: post.publishedAt,
    readingMinutes: post.readingMinutes,
    cover: cover?.src ? { src: cover.src, alt: post.coverImageAlt ?? "", unoptimized: cover.unoptimized } : null,
    tags: post.tags.map((t) => ({ label: t.name, href: listingHref(`/${post.section}`, { tag: t.slug }) })),
  };
}
