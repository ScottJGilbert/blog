import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/Skeleton";

/** Mirrors PostPage's frame (eyebrow, h1, meta row, 16:9 cover, text lines) inside the same container. */
export function PostSkeleton() {
  return (
    <PageContainer size="wide" className="py-8 sm:py-12">
      <div role="status" aria-label="Loading post" className="xl:grid xl:grid-cols-[minmax(0,44rem)_15rem] xl:justify-center xl:gap-14">
        <div className="min-w-0">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-10 w-full sm:h-12" />
          <Skeleton className="mt-3 h-10 w-2/3 sm:h-12" />
          <Skeleton className="mt-6 h-8 w-3/4" />
          <Skeleton className="mt-8 aspect-video w-full rounded-card" />
          <div className="mt-8 grid gap-3 border-t border-border pt-8">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className={i % 4 === 3 ? "h-5 w-2/3" : "h-5 w-full"} />
            ))}
          </div>
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    </PageContainer>
  );
}
