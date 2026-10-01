import type { Metadata } from "next";
import Link from "next/link";
import { LuSearch, LuSearchX } from "react-icons/lu";
import { Pagination } from "@/components/blog/Pagination";
import { PostCard } from "@/components/blog/PostCard";
import { toCardProps } from "@/components/blog/postCardProps";
import { TagFilter } from "@/components/blog/TagFilter";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { inputClass } from "@/components/ui/Field";
import { getPosts, getTags, isApiError, searchPosts } from "@/lib/api";
import { listingHref, parsePage, parseSection, parseTag } from "@/lib/paths";
import { renderSnippet } from "@/lib/snippet";

export const metadata: Metadata = {
  title: "Search",
  description: "Search every post on the blog.",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: true },
};

const PAGE_SIZE = 9;

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const rawQ = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const q = rawQ.length >= 2 ? rawQ : "";
  const section = parseSection(sp.section);
  const tag = parseTag(sp.tag);
  const page = parsePage(sp.page);
  const filters = { q: rawQ || undefined, section, tag };

  let results: Awaited<ReturnType<typeof getPosts>> | null = null;
  let snippets: Map<string, string> | null = null;
  let unavailable = false;

  if (q || tag) {
    try {
      if (q && !tag) {
        // Hybrid (full-text + vector) search with highlighted snippets.
        const res = await searchPosts({ q, section, page, pageSize: PAGE_SIZE });
        results = { data: res.data, meta: res.meta };
        snippets = new Map(res.data.map((r) => [r.id, r.snippet]));
      } else {
        // Tag browsing (optionally narrowed by q / section): the posts listing endpoint.
        results = await getPosts({ q: q || undefined, tag, section, page, pageSize: PAGE_SIZE });
      }
    } catch (err) {
      if (isApiError(err) && err.isValidation) results = null;
      else unavailable = true;
    }
  }

  const tags = !q && !tag ? await getTags().catch(() => []) : [];
  const tagName = tag ? (results?.data[0]?.tags.find((t) => t.slug === tag)?.name ?? tag) : undefined;
  const heading = q ? `Results for “${q}”` : tag ? `Posts tagged “${tagName}”` : null;

  return (
    <>
      <div className="section-motif">
        <PageContainer className="pt-12 pb-8 sm:pt-16">
          <SectionHeader eyebrow="Search" title="Search the blog" description="Find posts by keyword, topic or idea." />
          <form action="/search" method="get" role="search" className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            {tag && <input type="hidden" name="tag" value={tag} />}
            <div>
              <label htmlFor="search-q" className="block text-sm font-bold">
                Search posts
              </label>
              <input
                id="search-q"
                name="q"
                type="search"
                defaultValue={rawQ}
                minLength={2}
                maxLength={200}
                autoComplete="off"
                placeholder="e.g. postgres, hiking, typescript"
                className={`${inputClass} mt-2`}
              />
            </div>
            <div>
              <label htmlFor="search-section" className="block text-sm font-bold">
                Section
              </label>
              <select id="search-section" name="section" defaultValue={section ?? ""} className={`${inputClass} mt-2 sm:w-44`}>
                <option value="">All sections</option>
                <option value="personal">Personal</option>
                <option value="engineering">Engineering</option>
              </select>
            </div>
            <Button type="submit" size="lg" className="sm:min-h-11">
              <LuSearch aria-hidden className="size-4" />
              Search
            </Button>
          </form>
          {rawQ.length === 1 && <p className="mt-3 text-sm text-muted">Type at least 2 characters to search.</p>}
        </PageContainer>
      </div>

      <PageContainer className="pb-16">
        {unavailable ? (
          <EmptyState
            icon={<LuSearchX />}
            title="Search is unavailable right now"
            description="We couldn't reach the search service. Please try again in a moment."
            action={
              <ButtonLink href={listingHref("/search", filters)} variant="secondary">
                Try again
              </ButtonLink>
            }
          />
        ) : results ? (
          <>
            {heading && (
              <h2 className="mb-6 text-2xl">
                {heading}
                <span className="ml-3 font-accent text-lg font-normal text-muted">
                  {results.meta.total} {results.meta.total === 1 ? "post" : "posts"}
                </span>
              </h2>
            )}
            {results.data.length > 0 ? (
              <>
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {results.data.map((post, i) => (
                    <li key={post.id}>
                      <PostCard
                        {...toCardProps(post)}
                        snippet={snippets?.get(post.id) ? renderSnippet(snippets.get(post.id)!) : undefined}
                        priority={i === 0 && page === 1}
                      />
                    </li>
                  ))}
                </ul>
                <Pagination
                  className="mt-12"
                  currentPage={page}
                  totalPages={results.meta.totalPages}
                  getHref={(p) => listingHref("/search", { ...filters, page: p })}
                />
              </>
            ) : (
              <EmptyState
                icon={<LuSearchX />}
                title="No posts found"
                description={
                  q
                    ? `Nothing matched “${q}”. Check the spelling, try fewer or different words, or search all sections.`
                    : "No posts have this tag."
                }
                action={
                  <ButtonLink href="/search" variant="secondary">
                    Clear search
                  </ButtonLink>
                }
              />
            )}
          </>
        ) : (
          <>
            {tags.length > 0 && (
              <div>
                <h2 className="mb-4 text-2xl">Browse by tag</h2>
                <TagFilter base="/search" tags={tags} label="Browse by tag" showAll={false} extra={{ section }} />
              </div>
            )}
            <p className="text-muted">
              Or head straight to{" "}
              <Link href="/personal" className="font-semibold text-accent underline underline-offset-4">
                personal
              </Link>{" "}
              or{" "}
              <Link href="/engineering" className="font-semibold text-accent underline underline-offset-4">
                engineering
              </Link>
              .
            </p>
          </>
        )}
      </PageContainer>
    </>
  );
}
