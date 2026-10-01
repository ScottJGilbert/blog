"use client";

import Link from "next/link";
import { useCallback } from "react";
import useSWR from "swr";
import { LuEllipsis, LuExternalLink, LuEyeOff, LuPencil, LuPlus, LuSearch, LuSend, LuTrash2 } from "react-icons/lu";
import { POST_STATUSES, SECTIONS, type AdminPostSummary, type PostStatus, type Section } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TableScroll, TBody, Td, Th, THead, Tr, STICKY_ACTION_TD, STICKY_ACTION_TH } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { publicPostUrl } from "@/lib/base-path";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { useGroupMutate } from "@/lib/use-group-mutate";
import { useDebouncedQuery, useQueryState } from "@/lib/use-query-state";

const PAGE_SIZE = 15;
const SECTION_LABEL: Record<Section, string> = { personal: "Personal", engineering: "Engineering" };

export function PostsView() {
  const { values, page, set } = useQueryState(["status", "section", "q"] as const);
  const status = (POST_STATUSES as readonly string[]).includes(values.status) ? (values.status as PostStatus) : undefined;
  const section = (SECTIONS as readonly string[]).includes(values.section) ? (values.section as Section) : undefined;
  const q = values.q || undefined;
  const commitQ = useCallback((v: string) => set({ q: v }), [set]);
  const [qText, setQText] = useDebouncedQuery(values.q, commitQ);

  const toast = useToast();
  const confirm = useConfirm();
  const mutateGroup = useGroupMutate();

  const { data, error, isLoading, isValidating, mutate } = useSWR(["posts", { status, section, q, page }], () =>
    api.admin.posts.list({ status, section, q, page, pageSize: PAGE_SIZE }),
  );

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast.success(label);
      await mutateGroup("posts", "stats");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove(p: AdminPostSummary) {
    const ok = await confirm({
      title: "Delete this post?",
      description: (
        <>
          “{p.title}” will be permanently deleted{p.status === "published" ? " and removed from the public site" : ""}. This cannot be
          undone.
        </>
      ),
      confirmLabel: "Delete post",
      tone: "danger",
    });
    if (ok) await run("Post deleted", () => api.admin.posts.remove(p.id));
  }

  const filtered = Boolean(status || section || q);

  return (
    <>
      <PageHeader
        title="Posts"
        description="Write, schedule and publish posts across both sections."
        actions={
          <LinkButton href="/posts/new" variant="primary">
            <LuPlus aria-hidden className="size-4" />
            New post
          </LinkButton>
        }
      />

      <Card>
        <form
          role="search"
          aria-label="Filter posts"
          onSubmit={(e) => e.preventDefault()}
          className="grid gap-3 border-b border-edge p-4 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]"
        >
          <div className="relative">
            <Input
              label="Search posts"
              hideLabel
              type="search"
              placeholder="Search by title or text…"
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              className="pl-9"
              autoComplete="off"
            />
            <LuSearch aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          </div>
          <Select label="Status" hideLabel value={status ?? ""} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {POST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Select label="Section" hideLabel value={section ?? ""} onChange={(e) => set({ section: e.target.value })}>
            <option value="">All sections</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABEL[s]}
              </option>
            ))}
          </Select>
        </form>

        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <TableSkeleton rows={8} cols={5} label="Loading posts" />
        ) : data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No posts match these filters" : "No posts yet"}
            description={filtered ? "Try a different search or clear the filters." : "Create your first post to get started."}
            action={
              filtered ? (
                <LinkButton href="/posts">Clear filters</LinkButton>
              ) : (
                <LinkButton href="/posts/new" variant="primary">
                  New post
                </LinkButton>
              )
            }
          />
        ) : (
          <div aria-busy={isValidating} className={isValidating ? "opacity-80 transition-opacity" : undefined}>
            <TableScroll label="Posts">
              <Table>
                <THead>
                  <tr>
                    <Th className="w-[40%] min-w-[13rem]">Title</Th>
                    <Th>Section</Th>
                    <Th>Status</Th>
                    <Th>Author</Th>
                    <Th>Updated</Th>
                    <Th className={`w-12 ${STICKY_ACTION_TH}`}>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {data.data.map((p) => (
                    <Tr key={p.id}>
                      <Td className="max-w-0">
                        <Link href={`/posts/${p.id}`} className="block truncate font-medium hover:underline">
                          {p.title || "Untitled"}
                        </Link>
                        <span className="block truncate font-mono text-xs text-muted">/{p.section}/{p.slug}</span>
                      </Td>
                      <Td>{SECTION_LABEL[p.section]}</Td>
                      <Td>
                        <StatusBadge status={p.status} />
                        {p.status === "scheduled" && p.scheduledFor ? (
                          <time dateTime={p.scheduledFor} className="mt-1 block text-xs text-muted">
                            {formatDateTime(p.scheduledFor)}
                          </time>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap">{p.author.name}</Td>
                      <Td className="whitespace-nowrap text-muted">
                        <time dateTime={p.updatedAt}>{formatDate(p.updatedAt)}</time>
                      </Td>
                      <Td className={STICKY_ACTION_TD}>
                        <DropdownMenu
                          label={`Actions for ${p.title || "Untitled"}`}
                          triggerClassName="grid size-9 place-items-center rounded-ctl text-muted hover:bg-panel-2 hover:text-ink pointer-coarse:size-11"
                          trigger={<LuEllipsis aria-hidden className="size-5" />}
                          items={[
                            { id: "edit", label: "Edit", icon: <LuPencil className="size-4" />, href: `/posts/${p.id}` },
                            ...(p.status === "published"
                              ? [
                                  {
                                    id: "view",
                                    label: "View on site",
                                    icon: <LuExternalLink className="size-4" />,
                                    href: publicPostUrl(p.section, p.slug),
                                    external: true,
                                  },
                                  {
                                    id: "unpublish",
                                    label: "Unpublish",
                                    icon: <LuEyeOff className="size-4" />,
                                    onSelect: () => run("Post unpublished", () => api.admin.posts.unpublish(p.id)),
                                  },
                                ]
                              : [
                                  {
                                    id: "publish",
                                    label: "Publish now",
                                    icon: <LuSend className="size-4" />,
                                    onSelect: () => run("Post published", () => api.admin.posts.publish(p.id)),
                                  },
                                ]),
                            { id: "delete", label: "Delete…", icon: <LuTrash2 className="size-4" />, danger: true, separatorBefore: true, onSelect: () => remove(p) },
                          ]}
                        />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
            <Pagination meta={data.meta} onPage={(n) => set({ page: n }, { resetPage: false })} busy={isValidating} noun="posts" />
          </div>
        )}
      </Card>
    </>
  );
}
