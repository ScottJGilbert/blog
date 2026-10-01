import { LuArrowRight } from "react-icons/lu";
import { PostCard } from "@/components/blog/PostCard";
import { toCardProps } from "@/components/blog/postCardProps";
import { PageContainer } from "@/components/layout/PageContainer";
import { ButtonLink } from "@/components/ui/Button";
import { getPosts } from "@/lib/api";

/** Newest posts across both sections; each card previews its own section theme. */
export default async function LatestPosts() {
  const { data: posts } = await getPosts({ page: 1, pageSize: 6 });
  if (posts.length === 0) return null;
  return (
    <PageContainer size="wide" className="pb-16">
      <section aria-labelledby="latest-title">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <h2 id="latest-title" className="text-3xl">
            Latest writing
          </h2>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/personal" variant="secondary">
              Personal <LuArrowRight aria-hidden className="size-4" />
            </ButtonLink>
            <ButtonLink href="/engineering" variant="secondary">
              Engineering <LuArrowRight aria-hidden className="size-4" />
            </ButtonLink>
          </div>
        </div>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, i) => (
            <li key={post.id}>
              <PostCard {...toCardProps(post)} priority={i === 0} />
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
