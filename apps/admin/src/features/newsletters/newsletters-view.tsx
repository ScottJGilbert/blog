"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { LuEllipsis, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import { NEWSLETTER_STATUSES, type NewsletterStatus, type NewsletterSummary } from "@blog/shared";
import { emptyContentDoc } from "@/features/newsletters/empty-doc";
import { Card, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { FormError, Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TableScroll, TBody, Td, Th, THead, Tr, STICKY_ACTION_TD, STICKY_ACTION_TH } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorMessage, fieldErrorsFromApi } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useGroupMutate } from "@/lib/use-group-mutate";
import { useQueryState } from "@/lib/use-query-state";

const PAGE_SIZE = 15;

export function NewslettersView() {
  const { values, page, set } = useQueryState(["status"] as const);
  const status = (NEWSLETTER_STATUSES as readonly string[]).includes(values.status) ? (values.status as NewsletterStatus) : undefined;
  const toast = useToast();
  const confirm = useConfirm();
  const mutateGroup = useGroupMutate();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, error, isLoading, isValidating, mutate } = useSWR(["newsletters", { status, page }], () =>
    api.admin.newsletters.list({ status, page, pageSize: PAGE_SIZE }),
  );

  async function remove(n: NewsletterSummary) {
    const ok = await confirm({ title: "Delete this newsletter?", description: `“${n.subject}” will be permanently deleted.`, confirmLabel: "Delete newsletter", tone: "danger" });
    if (!ok) return;
    try {
      await api.admin.newsletters.remove(n.id);
      toast.success("Newsletter deleted");
      await mutateGroup("newsletters");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Newsletters"
        description="Compose, preview and send newsletters to confirmed subscribers."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<LuPlus aria-hidden className="size-4" />}>
            New newsletter
          </Button>
        }
      />
      <Card>
        <div className="border-b border-edge p-4 sm:max-w-xs">
          <Select label="Status" hideLabel value={status ?? ""} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {NEWSLETTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <TableSkeleton rows={6} cols={5} label="Loading newsletters" />
        ) : data.data.length === 0 ? (
          <EmptyState
            title={status ? "No newsletters with this status" : "No newsletters yet"}
            description="Create one from a post or start with a blank issue."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                New newsletter
              </Button>
            }
          />
        ) : (
          <div aria-busy={isValidating}>
            <TableScroll label="Newsletters">
              <Table>
                <THead>
                  <tr>
                    <Th className="w-[38%] min-w-[12rem]">Subject</Th>
                    <Th>Status</Th>
                    <Th>Date</Th>
                    <Th>Delivery</Th>
                    <Th className={`w-12 ${STICKY_ACTION_TH}`}>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {data.data.map((n) => (
                    <Tr key={n.id}>
                      <Td className="max-w-0">
                        <Link href={`/newsletters/${n.id}`} className="block truncate font-medium hover:underline">
                          {n.subject}
                        </Link>
                        {n.preheader ? <span className="block truncate text-xs text-muted">{n.preheader}</span> : null}
                      </Td>
                      <Td>
                        <StatusBadge status={n.status} />
                      </Td>
                      <Td className="whitespace-nowrap text-muted">
                        {n.status === "sent" ? formatDateTime(n.sentAt) : n.status === "scheduled" ? formatDateTime(n.scheduledFor) : formatDateTime(n.updatedAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-[0.8125rem] text-muted">
                        {n.stats && (n.stats.sent != null || n.stats.views != null)
                          ? `${n.stats.sent ?? 0} sent · ${n.stats.views ?? 0} opens · ${n.stats.clicks ?? 0} clicks`
                          : "—"}
                      </Td>
                      <Td className={STICKY_ACTION_TD}>
                        <DropdownMenu
                          label={`Actions for ${n.subject}`}
                          triggerClassName="grid size-9 place-items-center rounded-ctl text-muted hover:bg-panel-2 hover:text-ink pointer-coarse:size-11"
                          trigger={<LuEllipsis aria-hidden className="size-5" />}
                          items={[
                            { id: "open", label: n.status === "draft" ? "Edit" : "Open", icon: <LuPencil className="size-4" />, href: `/newsletters/${n.id}` },
                            { id: "delete", label: "Delete…", icon: <LuTrash2 className="size-4" />, danger: true, separatorBefore: true, onSelect: () => remove(n) },
                          ]}
                        />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
            <Pagination meta={data.meta} onPage={(n) => set({ page: n }, { resetPage: false })} busy={isValidating} noun="newsletters" />
          </div>
        )}
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New newsletter" size="md">
        {createOpen ? <CreateForm onClose={() => setCreateOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const mutateGroup = useGroupMutate();
  const [mode, setMode] = useState<"blank" | "post">("blank");
  const [subject, setSubject] = useState("");
  const [postId, setPostId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: posts } = useSWR(mode === "post" ? ["posts", { picker: "published" }] : null, () => api.admin.posts.list({ status: "published", pageSize: 50 }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const post = posts?.data.find((p) => p.id === postId);
    const subj = subject.trim() || post?.title || "";
    if (!subj) errs.subject = "Enter a subject line.";
    if (subj.length > 200) errs.subject = "The subject can be at most 200 characters.";
    if (mode === "post" && !postId) errs.postId = "Choose a post.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const n = await api.admin.newsletters.create(
        mode === "post" ? { subject: subj, postId } : { subject: subj, content: emptyContentDoc() },
      );
      await mutateGroup("newsletters");
      router.push(`/newsletters/${n.id}`);
    } catch (err) {
      setErrors(fieldErrorsFromApi(err));
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{formError}</FormError>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Start from</legend>
        {(
          [
            ["blank", "A blank newsletter", "Write custom content in the editor."],
            ["post", "An existing post", "Pre-filled from a published post."],
          ] as const
        ).map(([v, label, hint]) => (
          <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-ctl border border-edge p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} className="mt-0.5 size-4 border-edge-strong text-brand" />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-[0.8125rem] text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "post" ? (
        <Select label="Post" required value={postId} onChange={(e) => setPostId(e.target.value)} error={errors.postId}>
          <option value="">{posts ? "Select a published post…" : "Loading posts…"}</option>
          {posts?.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </Select>
      ) : null}
      <Input label="Subject" required={mode === "blank"} value={subject} onChange={(e) => setSubject(e.target.value)} error={errors.subject} hint={mode === "post" ? "Optional — defaults to the post title." : undefined} maxLength={220} data-autofocus />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>
          Create and edit
        </Button>
      </div>
    </form>
  );
}
