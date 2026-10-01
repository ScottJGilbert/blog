"use client";

import useSWR from "swr";
import type { LexicalContent } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { isApiError } from "@blog/shared/client";
import { PostForm } from "./post-form";

export function PostEditor({ postId, emptyDoc }: { postId?: string; emptyDoc?: LexicalContent }) {
  if (!postId) return <PostForm initial={null} emptyDoc={emptyDoc} />;
  return <ExistingPost postId={postId} />;
}

function ExistingPost({ postId }: { postId: string }) {
  const { data, error, mutate } = useSWR(["post", postId], () => api.admin.posts.get(postId), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    keepPreviousData: false,
  });

  if (data) return <PostForm key={data.id} initial={data} />;

  if (error) {
    const notFound = isApiError(error) && error.status === 404;
    return (
      <>
        <PageHeader title={notFound ? "Post not found" : "Could not load post"} crumbs={[{ label: "Posts", href: "/posts" }, { label: "Edit" }]} />
        <Card>
          <ErrorState
            title={notFound ? "This post does not exist" : "Could not load this post"}
            message={notFound ? "It may have been deleted." : errorMessage(error)}
            onRetry={notFound ? undefined : () => mutate()}
          />
          <div className="pb-6 text-center">
            <LinkButton href="/posts">Back to posts</LinkButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading post…</span>
      <PageHeader title="Edit post" crumbs={[{ label: "Posts", href: "/posts" }, { label: "Edit" }]} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[34rem] w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
