"use client";

import Link from "next/link";
import useSWR from "swr";
import { LuFileText, LuMail, LuMessageSquare, LuPlus, LuUsers } from "react-icons/lu";
import { Card, PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton, CardSkeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";

export function DashboardView() {
  const { data, error, isLoading, mutate } = useSWR(["stats"], () => api.admin.stats());

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="An overview of your content, community and audience."
        actions={
          <LinkButton href="/posts/new" variant="primary">
            <LuPlus aria-hidden className="size-4" />
            New post
          </LinkButton>
        }
      />

      {error && !data ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        </Card>
      ) : (
        <>
          <section aria-labelledby="stats-h" className="mb-6">
            <h2 id="stats-h" className="sr-only">
              Key figures
            </h2>
            {isLoading || !data ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <CardSkeleton key={i} className="h-[7.25rem]" label="Loading statistics" />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Published posts"
                  value={data.posts.published}
                  hint={`${data.posts.draft} drafts · ${data.posts.scheduled} scheduled`}
                  icon={<LuFileText className="size-5" />}
                  href="/posts?status=published"
                />
                <StatCard
                  label="Comments"
                  value={data.comments.total}
                  hint={data.comments.reported > 0 ? `${data.comments.reported} reported — needs review` : "No open reports"}
                  tone={data.comments.reported > 0 ? "warn" : undefined}
                  icon={<LuMessageSquare className="size-5" />}
                  href={data.comments.reported > 0 ? "/comments?tab=reported" : "/comments"}
                />
                <StatCard
                  label="Users"
                  value={data.users.total}
                  hint={`${data.users.admins} ${data.users.admins === 1 ? "admin" : "admins"}`}
                  icon={<LuUsers className="size-5" />}
                  href="/users"
                />
                <StatCard
                  label="Subscribers"
                  value={data.subscribers.confirmed}
                  hint={`${data.subscribers.pending} pending confirmation`}
                  icon={<LuMail className="size-5" />}
                  href="/subscribers"
                />
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card aria-labelledby="recent-posts-h" className="min-w-0">
              <div className="flex items-center justify-between border-b border-edge px-4 py-3">
                <h2 id="recent-posts-h" className="text-sm font-semibold">
                  Recent posts
                </h2>
                <Link href="/posts" className="rounded text-[0.8125rem] font-medium text-brand hover:underline">
                  View all<span className="sr-only"> posts</span>
                </Link>
              </div>
              {isLoading || !data ? (
                <ListSkeleton label="Loading recent posts" />
              ) : data.recentPosts.length === 0 ? (
                <EmptyState
                  title="No posts yet"
                  description="Write your first post to see it here."
                  action={
                    <LinkButton href="/posts/new" variant="primary">
                      New post
                    </LinkButton>
                  }
                />
              ) : (
                <ul className="divide-y divide-edge">
                  {data.recentPosts.map((p) => (
                    <li key={p.id} className="flex min-h-[3.75rem] items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/posts/${p.id}`} className="block truncate font-medium hover:underline">
                          {p.title}
                        </Link>
                        <p className="text-[0.8125rem] text-muted">
                          {p.section === "engineering" ? "Engineering" : "Personal"} · updated{" "}
                          <time dateTime={p.updatedAt}>{formatRelative(p.updatedAt)}</time>
                        </p>
                      </div>
                      <StatusBadge status={p.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card aria-labelledby="recent-comments-h" className="min-w-0">
              <div className="flex items-center justify-between border-b border-edge px-4 py-3">
                <h2 id="recent-comments-h" className="text-sm font-semibold">
                  Recent comments
                </h2>
                <Link href="/comments" className="rounded text-[0.8125rem] font-medium text-brand hover:underline">
                  Moderate<span className="sr-only"> comments</span>
                </Link>
              </div>
              {isLoading || !data ? (
                <ListSkeleton label="Loading recent comments" />
              ) : data.recentComments.length === 0 ? (
                <EmptyState title="No comments yet" description="Reader comments will appear here." icon={<LuMessageSquare className="size-6" />} />
              ) : (
                <ul className="divide-y divide-edge">
                  {data.recentComments.map((c) => (
                    <li key={c.id} className="min-h-[3.75rem] px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-[0.8125rem] text-muted">
                          <span className="font-medium text-ink">{c.authorName}</span> on{" "}
                          <Link href={`/posts?q=${encodeURIComponent(c.postTitle)}`} className="hover:underline">
                            {c.postTitle}
                          </Link>
                        </p>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="mt-0.5 line-clamp-2 break-words text-sm">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-edge">
      <span className="sr-only">{label}…</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex h-[3.75rem] items-center justify-between gap-3 px-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
