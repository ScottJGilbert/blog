import type { ReactNode } from "react";
import type { Section } from "@blog/shared";
import { LuPenLine, LuTerminal } from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPosts, LISTING_PAGE_SIZE } from "@/lib/api";
import { listingHref } from "@/lib/paths";
import { Pagination } from "./Pagination";
import { PostCard } from "./PostCard";
import { toCardProps } from "./postCardProps";
import { facetsFromPosts, TagFilter } from "./TagFilter";

interface SectionCopy {
  eyebrow: string;
  title: string;
  description: string;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  emptyStatus?: string;
}

export const SECTION_COPY: Record<Section, SectionCopy> = {
  personal: {
    eyebrow: "Reflections",
    title: "Personal",
    description: "Life updates, philosophical reflections, and what I’m currently learning beyond the screen.",
    emptyIcon: <LuPenLine />,
    emptyTitle: "The first entry is on its way",
    emptyDescription: "I’m still gathering my thoughts. Check back soon for the first story.",
  },
  engineering: {
    eyebrow: "~/engineering",
    title: "Engineering Insights",
    description:
      "Some insights from my time in the “field”, and lessons learned from both development and (regrettably) production.",
    emptyIcon: <LuTerminal />,
    emptyTitle: "Under construction",
    emptyDescription: "Check back soon for the first publication.",
    emptyStatus: "status: compilation_in_progress",
  },
};

/**
 * Paginated, tag-filterable listing of one section. Server component; filters live in the URL (`?page=&tag=`).
 * Tag chips are derived from the section's own posts (one cached fetch of up to 50), so a chip never leads to an
 * empty page.
 */
export async function SectionListing({ section, page, tag }: { section: Section; page: number; tag?: string }) {
  const copy = SECTION_COPY[section];
  const base = `/${section}`;
  const [list, facetSource] = await Promise.all([
    getPosts({ section, page, pageSize: LISTING_PAGE_SIZE, tag }),
    getPosts({ section, page: 1, pageSize: 50 }),
  ]);
  const facets = facetsFromPosts(facetSource.data);
  const activeName = facets.find((f) => f.slug === tag)?.name ?? tag;
  const { totalPages, total } = list.meta;

  return (
    <>
      <div className="section-motif">
        <PageContainer className="pt-12 pb-10 sm:pt-16">
          <SectionHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
        </PageContainer>
      </div>
      <PageContainer className="pb-16">
        <TagFilter base={base} tags={facets} active={tag} />

        {list.data.length > 0 ? (
          <>
            <p className="sr-only">
              {tag ? `${total} ${total === 1 ? "post" : "posts"} tagged ${activeName}` : `${total} ${total === 1 ? "post" : "posts"}`}
              {totalPages > 1 ? `, page ${page} of ${totalPages}` : ""}
            </p>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {list.data.map((post, i) => (
                <li key={post.id}>
                  <PostCard {...toCardProps(post)} priority={i === 0 && page === 1} />
                </li>
              ))}
            </ul>
            <Pagination
              className="mt-12"
              currentPage={page}
              totalPages={totalPages}
              getHref={(p) => listingHref(base, { page: p, tag })}
            />
          </>
        ) : tag || page > 1 ? (
          <>
            {/* A page past the last one is a soft 404: keep it out of search indexes (React hoists <meta> into <head>). */}
            {!tag && <meta name="robots" content="noindex" />}
            <EmptyState
              icon={copy.emptyIcon}
              title={tag ? `No posts tagged “${activeName}”` : "That page doesn’t exist"}
              description={tag ? "Try another tag, or browse everything." : "There aren’t that many posts yet."}
              action={
                <ButtonLink href={base} variant="secondary">
                  {tag ? "Clear filter" : `Back to ${copy.title.toLowerCase()}`}
                </ButtonLink>
              }
            />
          </>
        ) : (
          <EmptyState
            icon={copy.emptyIcon}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            status={copy.emptyStatus}
          />
        )}
      </PageContainer>
    </>
  );
}

export function listingMetadata(section: Section, page: number, tag?: string) {
  const copy = SECTION_COPY[section];
  const suffix = [tag ? `#${tag}` : null, page > 1 ? `Page ${page}` : null].filter(Boolean).join(", ");
  return {
    title: suffix ? `${copy.title}: ${suffix}` : copy.title,
    description: copy.description,
    alternates: { canonical: listingHref(`/${section}`, { page, tag }) },
    ...(tag ? { robots: { index: false, follow: true } } : {}),
  };
}
