"use client";

import Link from "next/link";
import { useSWRConfig } from "swr";
import useSWR from "swr";
import { LuCircleCheck, LuEye, LuEyeOff, LuFlag, LuMessageSquare, LuTrash2, LuUndo2 } from "react-icons/lu";
import type { AdminComment, CommentStatus, Paginated } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { publicPostUrl } from "@/lib/base-path";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useGroupMutate } from "@/lib/use-group-mutate";
import { useQueryState } from "@/lib/use-query-state";

type Tab = "all" | "reported" | "hidden";
const PAGE_SIZE = 10;

export function CommentsView() {
  const { values, page, set } = useQueryState(["tab"] as const);
  const tab: Tab = values.tab === "reported" || values.tab === "hidden" ? values.tab : "all";
  const key = ["comments", { tab, page }] as const;
  const toast = useToast();
  const confirm = useConfirm();
  const mutateGroup = useGroupMutate();
  const { mutate: globalMutate } = useSWRConfig();

  const { data, error, isLoading, isValidating, mutate } = useSWR(key, () =>
    api.admin.comments.list({
      page,
      pageSize: PAGE_SIZE,
      ...(tab === "reported" ? { reported: "true" } : {}),
      ...(tab === "hidden" ? { status: "hidden" as const } : {}),
    }),
  );
  // counts for the tab badges
  const { data: reportedCount } = useSWR(["comments", "count-reported"], () => api.admin.comments.list({ reported: "true", pageSize: 1 }).then((r) => r.meta.total));
  const { data: hiddenCount } = useSWR(["comments", "count-hidden"], () => api.admin.comments.list({ status: "hidden", pageSize: 1 }).then((r) => r.meta.total));

  /** Optimistic status change with rollback. */
  async function setStatus(c: AdminComment, status: CommentStatus, okMsg: string) {
    const prev = data;
    const apply = (cur?: Paginated<AdminComment>) =>
      cur ? { ...cur, data: cur.data.map((x) => (x.id === c.id ? { ...x, status } : x)) } : cur;
    await mutate(
      async () => {
        try {
          await api.admin.comments.setStatus(c.id, { status });
          toast.success(okMsg);
          return apply(prev);
        } catch (err) {
          toast.error(errorMessage(err));
          return prev;
        }
      },
      { optimisticData: apply(prev), rollbackOnError: true, revalidate: false },
    );
    void mutateGroup("comments", "stats");
    void globalMutate((k) => Array.isArray(k) && k[0] === "comments");
  }

  async function remove(c: AdminComment) {
    const ok = await confirm({
      title: "Delete this comment?",
      description: "The comment is removed from the site (replies stay visible). You can restore it from the All tab.",
      confirmLabel: "Delete comment",
      tone: "danger",
    });
    if (ok) await setStatus(c, "deleted", "Comment deleted");
  }

  async function resolve(c: AdminComment) {
    try {
      await api.admin.comments.resolveReports(c.id);
      toast.success("Reports resolved");
      await mutateGroup("comments", "stats");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader title="Comments" description="Review reader comments, handle reports, hide or remove abusive content." />
      <Card>
        <Tabs
          label="Comment filters"
          value={tab}
          onChange={(t) => set({ tab: t === "all" ? "" : t })}
          tabs={[
            { id: "all", label: "All" },
            { id: "reported", label: "Reported", count: reportedCount },
            { id: "hidden", label: "Hidden", count: hiddenCount },
          ]}
        >
          {error && !data ? (
            <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
          ) : isLoading || !data ? (
            <div role="status" aria-busy="true" className="divide-y divide-edge">
              <span className="sr-only">Loading comments…</span>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2 p-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : data.data.length === 0 ? (
            <EmptyState
              title={tab === "reported" ? "No reported comments" : tab === "hidden" ? "No hidden comments" : "No comments yet"}
              description={tab === "reported" ? "Nothing needs your attention right now." : "Comments will appear here when readers post them."}
              icon={tab === "reported" ? <LuCircleCheck className="size-6" /> : <LuMessageSquare className="size-6" />}
            />
          ) : (
            <div aria-busy={isValidating}>
              <ul className="divide-y divide-edge">
                {data.data.map((c) => {
                  const open = c.reports.filter((r) => !r.resolvedAt);
                  return (
                    <li key={c.id} className="space-y-2.5 p-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="text-sm font-semibold">{c.author?.name ?? "Deleted user"}</p>
                        {c.author ? <p className="text-[0.8125rem] text-muted">{c.author.email}</p> : null}
                        <StatusBadge status={c.status} />
                        {c.parentId ? <Badge>Reply</Badge> : null}
                        {c.openReportCount > 0 ? (
                          <Badge tone="warn">
                            {c.openReportCount} open {c.openReportCount === 1 ? "report" : "reports"}
                          </Badge>
                        ) : null}
                        <time dateTime={c.createdAt} className="ml-auto text-[0.8125rem] text-muted">
                          {formatDateTime(c.createdAt)}
                        </time>
                      </div>
                      <p className="text-[0.8125rem] text-muted">
                        On{" "}
                        {c.status === "deleted" ? (
                          c.post.title
                        ) : (
                          <a
                            href={`${publicPostUrl(c.post.section, c.post.slug)}#comment-${c.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-brand hover:underline"
                          >
                            {c.post.title}
                            <span className="sr-only"> (opens the public post in a new tab)</span>
                          </a>
                        )}{" "}
                        ·{" "}
                        <Link href={`/posts?q=${encodeURIComponent(c.post.title)}`} className="hover:underline">
                          Find in posts
                        </Link>
                      </p>
                      <p className={`whitespace-pre-wrap break-words text-sm ${c.status !== "visible" ? "text-muted" : ""}`}>{c.body}</p>

                      {c.reports.length > 0 ? (
                        <details className="rounded-ctl border border-edge bg-panel-2/50 px-3 py-2 text-sm">
                          <summary className="flex min-h-8 items-center gap-2 font-medium">
                            <LuFlag aria-hidden className="size-4 text-warn" />
                            {c.reports.length} {c.reports.length === 1 ? "report" : "reports"} ({open.length} open)
                          </summary>
                          <ul className="mt-2 space-y-1.5">
                            {c.reports.map((r) => (
                              <li key={r.id} className="text-[0.8125rem]">
                                <span className="font-medium">{r.reporter.name}</span>{" "}
                                <span className="text-muted">· {formatDateTime(r.createdAt)}{r.resolvedAt ? " · resolved" : ""}</span>
                                <p className="break-words">{r.reason}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        {open.length > 0 ? (
                          <Button size="sm" icon={<LuCircleCheck aria-hidden className="size-4" />} onClick={() => resolve(c)}>
                            Resolve reports
                          </Button>
                        ) : null}
                        {c.status === "visible" ? (
                          <Button size="sm" icon={<LuEyeOff aria-hidden className="size-4" />} onClick={() => setStatus(c, "hidden", "Comment hidden")}>
                            Hide
                          </Button>
                        ) : null}
                        {c.status === "hidden" ? (
                          <Button size="sm" icon={<LuEye aria-hidden className="size-4" />} onClick={() => setStatus(c, "visible", "Comment is visible again")}>
                            Unhide
                          </Button>
                        ) : null}
                        {c.status === "deleted" ? (
                          <Button size="sm" icon={<LuUndo2 aria-hidden className="size-4" />} onClick={() => setStatus(c, "visible", "Comment restored")}>
                            Restore
                          </Button>
                        ) : (
                          <Button size="sm" variant="danger-outline" icon={<LuTrash2 aria-hidden className="size-4" />} onClick={() => remove(c)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pagination meta={data.meta} onPage={(n) => set({ page: n }, { resetPage: false })} busy={isValidating} noun="comments" />
            </div>
          )}
        </Tabs>
      </Card>
    </>
  );
}
