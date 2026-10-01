import { notFound, permanentRedirect } from "next/navigation";
import type { Section } from "@blog/shared";
import { api, getPost, getRelated } from "@/lib/api";
import { PageContainer } from "@/components/layout/PageContainer";
import { CommentsLazy } from "@/components/comments/CommentsLazy";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";
import { postHref } from "@/lib/paths";
import { SITE_URL } from "@/lib/site-url";
import { PostCard } from "../PostCard";
import { toCardProps } from "../postCardProps";
import { blogPostingJsonLd, jsonLdString } from "./post-meta";
import { PostContent } from "./PostContent";
import { PostHeader } from "./PostHeader";
import { PostNav } from "./PostNav";
import { PostTocDisclosure, PostTocSidebar } from "./PostToc";
import { ShareBar } from "../ShareBar";

/** Slugs of one section for generateStaticParams. Never throws: on-demand ISR covers anything missed. */
export async function sectionStaticParams(section: Section): Promise<{ slug: string }[]> {
  try {
    const entries = await api.sitemap({ next: { revalidate: 600, tags: ["posts"] } });
    return entries.filter((e) => e.section === section).map((e) => ({ slug: e.slug }));
  } catch {
    return [];
  }
}

export async function PostPage({ section, slug }: { section: Section; slug: string }) {
  const post = await getPost(slug);
  if (!post) notFound();
  // The slug exists but belongs to the other section: send the visitor (and crawlers) to the canonical URL.
  if (post.section !== section) permanentRedirect(postHref(post.section, post.slug));

  const related = await getRelated(slug, 3);
  const url = `${SITE_URL}${postHref(post.section, post.slug)}`;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(blogPostingJsonLd(post)) }} />
      <PageContainer size="wide" className="py-8 sm:py-12">
        <div className="xl:grid xl:grid-cols-[minmax(0,44rem)_15rem] xl:justify-center xl:gap-14">
          <article className="min-w-0">
            <PostHeader post={post} />
            <div className="mt-8 border-t border-border pt-8">
              <PostTocDisclosure toc={post.toc} />
              <PostContent html={post.contentHtml} />
            </div>
            <div className="mt-10 border-t border-border pt-6">
              <p className="mb-3 text-sm font-bold">Share this post</p>
              <ShareBar url={url} title={post.title} />
            </div>
          </article>
          <PostTocSidebar toc={post.toc} />
        </div>

        <div className="mx-auto mt-14 grid max-w-reading gap-14">
          <PostNav prev={post.prev} next={post.next} />

          <NewsletterSignup
            source="post"
            title="Enjoyed this? Get the next one by email"
            description="New posts straight to your inbox. No spam, unsubscribe any time."
          />

          {related.length > 0 && (
            <section aria-labelledby="related-title">
              <h2 id="related-title" className="text-2xl">
                Related posts
              </h2>
              <ul className="mt-5 grid gap-6">
                {related.map((r) => (
                  <li key={r.id}>
                    <PostCard {...toCardProps(r)} headingLevel="h3" layout="horizontal" sizes="(min-width: 768px) 280px, 100vw" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <CommentsLazy slug={post.slug} />
        </div>
      </PageContainer>
    </>
  );
}
