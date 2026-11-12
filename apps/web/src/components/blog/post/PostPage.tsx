import { clsx } from "clsx";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Section } from "@blog/shared";
import { apiDownAtBuild, api, getPost, getRelated, noteBuildOutage } from "@/lib/api";
import { PageContainer } from "@/components/layout/PageContainer";
import { CommentsLazy } from "@/components/comments/CommentsLazy";
import { formatDate } from "@/lib/format";
import { postHref } from "@/lib/paths";
import { SITE_URL } from "@/lib/site-url";
import { RecipeHeader } from "@/components/cookbook/RecipeHeader";
import { toCardProps } from "../postCardProps";
import { blogPostingJsonLd, jsonLdString } from "./post-meta";
import { PostContent } from "./PostContent";
import { PostHeader } from "./PostHeader";
import { PostNav } from "./PostNav";
import { PostTocDisclosure, PostTocSidebar } from "./PostToc";
import { ShareBar } from "../ShareBar";

/**
 * Slugs of one section for generateStaticParams. Never throws and never waits on a missing API: without one (first deploy,
 * `next build` before the API service is up) it returns `[]` and every post is rendered on demand (ISR) instead.
 */
export async function sectionStaticParams(section: Section): Promise<{ slug: string }[]> {
  if (apiDownAtBuild()) return [];
  try {
    const entries = await api.sitemap({ next: { revalidate: 600, tags: ["posts"] } });
    return entries.filter((e) => e.section === section).map((e) => ({ slug: e.slug }));
  } catch {
    noteBuildOutage();
    return [];
  }
}

export async function PostPage({ section, slug }: { section: Section; slug: string }) {
  const post = await getPost(slug);
  if (!post) notFound();
  // The slug exists but belongs to the other section: send the visitor (and crawlers) to the canonical URL.
  if (post.section !== section) permanentRedirect(postHref(post.section, post.slug));

  const recipe = post.section === "cookbook";
  const related = await getRelated(slug, 3);
  const url = `${SITE_URL}${postHref(post.section, post.slug)}`;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(blogPostingJsonLd(post)) }} />
      <PageContainer size="wide" className="py-8 sm:py-12">
        <div className="xl:grid xl:grid-cols-[minmax(0,48rem)_15rem] xl:justify-between xl:gap-14">
          <article className="min-w-0 max-w-3xl">
            {recipe ? <RecipeHeader post={post} /> : <PostHeader post={post} />}
            <div className="mt-8 border-t border-border pt-8">
              <div className={recipe ? "print:hidden" : undefined}>
                <PostTocDisclosure toc={post.toc} />
              </div>
              <PostContent html={post.contentHtml} />
            </div>
            <div className={clsx("mt-10 border-t border-border pt-6", recipe && "print:hidden")}>
              <p className="mb-3 text-sm font-bold">{recipe ? "Share this recipe" : "Share this post"}</p>
              <ShareBar url={url} title={post.title} />
            </div>
          </article>
          <div className={recipe ? "print:hidden" : undefined}>
            <PostTocSidebar toc={post.toc} />
          </div>
        </div>

        <div className={clsx("mt-14 grid max-w-3xl grid-cols-1 gap-14", recipe && "print:hidden")}>
          <PostNav prev={post.prev} next={post.next} />

          {related.length > 0 && (
            <section aria-labelledby="related-title">
              <h2 id="related-title" className="text-2xl">
                {recipe ? "More from the cookbook" : "Related posts"}
              </h2>
              <ul className="mt-5 grid gap-3">
                {related.map((r) => {
                  const card = toCardProps(r);
                  return (
                    <li key={r.id}>
                      {/* Compact row (thumbnail + date + title) so comments stay close; styled like PostNav's cards. */}
                      <Link
                        prefetch={false}
                        href={card.href}
                        data-section={r.section}
                        className="group flex items-center gap-4 rounded-card border border-border bg-surface p-3 text-fg transition-colors hover:border-accent"
                      >
                        {card.cover && (
                          <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-control bg-surface-2 sm:w-32">
                            <Image
                              src={card.cover.src}
                              alt=""
                              width={256}
                              height={144}
                              sizes="128px"
                              unoptimized={card.cover.unoptimized}
                              className="size-full object-cover"
                            />
                          </div>
                        )}
                        <div className="min-w-0">
                          <time dateTime={r.publishedAt} className="font-accent text-sm text-muted">
                            {formatDate(r.publishedAt)}
                          </time>
                          <h3 className="line-clamp-2 font-display text-lg leading-snug font-bold group-hover:text-accent">{r.title}</h3>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <CommentsLazy slug={post.slug} />
        </div>
      </PageContainer>
    </>
  );
}
