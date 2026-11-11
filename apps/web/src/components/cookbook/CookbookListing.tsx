import { LuChefHat } from "react-icons/lu";
import { PageContainer } from "@/components/layout/PageContainer";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { Pagination } from "@/components/blog/Pagination";
import { facetsFromPosts, TagFilter } from "@/components/blog/TagFilter";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPosts, LISTING_PAGE_SIZE } from "@/lib/api";
import { listingHref } from "@/lib/paths";
import { RecipeCard } from "./RecipeCard";

export const COOKBOOK_COPY = {
  eyebrow: "Recipes",
  title: "The Cookbook",
  description: "Recipes I’ve actually cooked, written down so I can make them again: ingredients, method, and what I’d change next time.",
};

/**
 * The cookbook index: numbered recipe cards, filtered by "course" (tag). Server component; filters live in the URL
 * (`?page=&tag=`), exactly like the blog listings, so caching, pagination and the soft-404 handling are shared.
 */
export async function CookbookListing({ page, tag }: { page: number; tag?: string }) {
  const base = "/cookbook";
  const [list, facetSource] = await Promise.all([
    getPosts({ section: "cookbook", page, pageSize: LISTING_PAGE_SIZE, tag }),
    getPosts({ section: "cookbook", page: 1, pageSize: 50 }),
  ]);
  const facets = facetsFromPosts(facetSource.data);
  const activeName = facets.find((f) => f.slug === tag)?.name ?? tag;
  const { totalPages, total } = list.meta;
  const first = (page - 1) * LISTING_PAGE_SIZE;

  return (
    <>
      <div className="section-motif">
        <PageContainer className="pt-12 pb-10 sm:pt-16">
          <SectionHeader {...COOKBOOK_COPY} />
        </PageContainer>
      </div>
      <PageContainer className="pb-16">
        <TagFilter base={base} tags={facets} active={tag} label="Filter recipes by course" />

        {list.data.length > 0 ? (
          <>
            <p className="sr-only">
              {tag ? `${total} ${total === 1 ? "recipe" : "recipes"} filed under ${activeName}` : `${total} ${total === 1 ? "recipe" : "recipes"}`}
              {totalPages > 1 ? `, page ${page} of ${totalPages}` : ""}
            </p>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {list.data.map((recipe, i) => (
                <li key={recipe.id}>
                  <RecipeCard recipe={recipe} number={first + i + 1} priority={i === 0 && page === 1} />
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
              icon={<LuChefHat />}
              title={tag ? `No recipes filed under “${activeName}”` : "That page doesn’t exist"}
              description={tag ? "Try another course, or browse every recipe." : "The book isn’t that long yet."}
              action={
                <ButtonLink href={base} variant="secondary">
                  {tag ? "Clear filter" : "Back to the cookbook"}
                </ButtonLink>
              }
            />
          </>
        ) : (
          <EmptyState
            icon={<LuChefHat />}
            title="The first recipe is still in the oven"
            description="Nothing has been written down yet. Check back soon."
          />
        )}
      </PageContainer>
    </>
  );
}
