import Link from "next/link";
import type { PostNavRef } from "@blog/shared";
import { LuArrowLeft, LuArrowRight } from "react-icons/lu";
import { postHref } from "@/lib/paths";

function NavCard({ post, dir }: { post: PostNavRef; dir: "prev" | "next" }) {
  const Icon = dir === "prev" ? LuArrowLeft : LuArrowRight;
  return (
    <Link
      prefetch={false}
      href={postHref(post.section, post.slug)}
      rel={dir}
      className={`group flex min-h-24 flex-col justify-center gap-1 rounded-card border border-border bg-surface p-4 transition-colors hover:border-accent sm:p-5 ${
        dir === "next" ? "text-right sm:items-end" : ""
      }`}
    >
      <span className="eyebrow inline-flex items-center gap-1.5 text-muted">
        {dir === "prev" && <Icon aria-hidden className="size-4" />}
        {dir === "prev" ? "Older post" : "Newer post"}
        {dir === "next" && <Icon aria-hidden className="size-4" />}
      </span>
      <span className="font-display text-lg leading-snug font-bold text-fg group-hover:text-accent">{post.title}</span>
    </Link>
  );
}

/** Previous / next post within the same section. `prev` = older, `next` = newer (per the API). */
export function PostNav({ prev, next }: { prev: PostNavRef | null; next: PostNavRef | null }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="More from this section" className="grid gap-4 sm:grid-cols-2">
      <div>{prev && <NavCard post={prev} dir="prev" />}</div>
      <div>{next && <NavCard post={next} dir="next" />}</div>
    </nav>
  );
}
