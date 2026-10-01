"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { LuRefreshCw, LuSearch, LuTrash2 } from "react-icons/lu";
import { SUBSCRIBER_STATUSES, type Subscriber, type SubscriberStatus } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TableScroll, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useGroupMutate } from "@/lib/use-group-mutate";
import { useDebouncedQuery, useQueryState } from "@/lib/use-query-state";

const PAGE_SIZE = 20;

export function SubscribersView() {
  const { values, page, set } = useQueryState(["q", "status"] as const);
  const status = (SUBSCRIBER_STATUSES as readonly string[]).includes(values.status) ? (values.status as SubscriberStatus) : undefined;
  const q = values.q || undefined;
  const commitQ = useCallback((v: string) => set({ q: v }), [set]);
  const [qText, setQText] = useDebouncedQuery(values.q, commitQ);
  const toast = useToast();
  const confirm = useConfirm();
  const mutateGroup = useGroupMutate();
  const [syncing, setSyncing] = useState(false);

  const { data, error, isLoading, isValidating, mutate } = useSWR(["subscribers", { q, status, page }], () =>
    api.admin.subscribers.list({ q, status, page, pageSize: PAGE_SIZE }),
  );

  async function remove(s: Subscriber) {
    const ok = await confirm({
      title: "Delete this subscriber?",
      description: `${s.email} will be removed from the list and the newsletter provider. They can subscribe again later.`,
      confirmLabel: "Delete subscriber",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.admin.subscribers.remove(s.id);
      toast.success("Subscriber deleted");
      await mutateGroup("subscribers", "stats");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const r = await api.admin.subscribers.sync();
      if (!r.providerConfigured) toast.info("No newsletter provider is configured (LISTMONK_URL is unset), so there is nothing to sync.");
      else toast.success(`Synced ${r.synced} subscribers${r.failed ? `, ${r.failed} failed` : ""}.`);
      await mutateGroup("subscribers");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  const filtered = Boolean(q || status);
  return (
    <>
      <PageHeader
        title="Subscribers"
        description="People subscribed to the newsletter."
        actions={
          <Button onClick={sync} loading={syncing} icon={<LuRefreshCw aria-hidden className="size-4" />}>
            Sync with provider
          </Button>
        }
      />
      <Card>
        <form role="search" aria-label="Filter subscribers" onSubmit={(e) => e.preventDefault()} className="grid gap-3 border-b border-edge p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="relative">
            <Input label="Search subscribers" hideLabel type="search" placeholder="Search by email…" value={qText} onChange={(e) => setQText(e.target.value)} className="pl-9" autoComplete="off" />
            <LuSearch aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          </div>
          <Select label="Status" hideLabel value={status ?? ""} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {SUBSCRIBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </form>
        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <TableSkeleton rows={8} cols={4} label="Loading subscribers" />
        ) : data.data.length === 0 ? (
          <EmptyState title={filtered ? "No subscribers match these filters" : "No subscribers yet"} description={filtered ? "Try a different search." : "Subscribers appear here once readers sign up on the site."} />
        ) : (
          <div aria-busy={isValidating}>
            <TableScroll label="Subscribers">
              <Table className="min-w-[36rem]">
                <THead>
                  <tr>
                    <Th>Email</Th>
                    <Th>Status</Th>
                    <Th>Source</Th>
                    <Th>Subscribed</Th>
                    <Th className="w-12">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {data.data.map((s) => (
                    <Tr key={s.id}>
                      <Td className="max-w-0 truncate font-medium">{s.email}</Td>
                      <Td>
                        <StatusBadge status={s.status} />
                      </Td>
                      <Td className="text-muted">{s.source ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-muted">{formatDate(s.confirmedAt ?? s.createdAt)}</Td>
                      <Td>
                        <IconButton label={`Delete subscriber ${s.email}`} size="sm" onClick={() => remove(s)}>
                          <LuTrash2 aria-hidden className="size-4 text-danger" />
                        </IconButton>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
            <Pagination meta={data.meta} onPage={(n) => set({ page: n }, { resetPage: false })} busy={isValidating} noun="subscribers" />
          </div>
        )}
      </Card>
    </>
  );
}
