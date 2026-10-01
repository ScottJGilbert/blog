import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/Skeleton";
import { PostCardSkeleton } from "./PostCard";

/**
 * Loading UI for a section listing: mirrors PageContainer + SectionHeader +
 * a 1/2/3-column PostCard grid so content swaps in without shifting.
 */
export function ListingSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <PageContainer className="py-12 sm:py-16">
      <div role="status" aria-label="Loading posts">
        <div className="pb-10">
          <Skeleton className="mb-3 h-4 w-28" />
          <Skeleton className="h-10 w-3/4 max-w-md sm:h-12" />
          <Skeleton className="mt-4 h-14 w-full max-w-2xl" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: cards }, (_, i) => (
            <PostCardSkeleton key={i} />
          ))}
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    </PageContainer>
  );
}
