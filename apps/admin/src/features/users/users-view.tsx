"use client";

import { useCallback, useState, type FormEvent } from "react";
import useSWR from "swr";
import { LuBan, LuEllipsis, LuSearch, LuShieldCheck, LuTrash2, LuUserCheck, LuUserMinus } from "react-icons/lu";
import { USER_ROLES, type AdminUser, type UserRole } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { FormError, Input, Select, Textarea } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TableScroll, TBody, Td, Th, THead, Tr, STICKY_ACTION_TD, STICKY_ACTION_TH } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useGroupMutate } from "@/lib/use-group-mutate";
import { useDebouncedQuery, useQueryState } from "@/lib/use-query-state";

const PAGE_SIZE = 15;

export function UsersView() {
  const { values, page, set } = useQueryState(["q", "role", "state"] as const);
  const role = (USER_ROLES as readonly string[]).includes(values.role) ? (values.role as UserRole) : undefined;
  const state = values.state === "banned" || values.state === "active" ? values.state : "";
  const q = values.q || undefined;
  const commitQ = useCallback((v: string) => set({ q: v }), [set]);
  const [qText, setQText] = useDebouncedQuery(values.q, commitQ);
  const toast = useToast();
  const confirm = useConfirm();
  const mutateGroup = useGroupMutate();
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);

  const { data: me } = useSWR(["me"], () => api.me());
  const { data, error, isLoading, isValidating, mutate } = useSWR(["users", { q, role, state, page }], () =>
    api.admin.users.list({ q, role, page, pageSize: PAGE_SIZE, ...(state ? { banned: state === "banned" ? "true" : "false" } : {}) }),
  );

  async function run(okMsg: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast.success(okMsg);
      await mutateGroup("users", "stats");
    } catch (err) {
      // Guard rails (cannot change yourself / the last admin) come back as readable API messages.
      toast.error(errorMessage(err));
    }
  }

  async function changeRole(u: AdminUser, next: UserRole) {
    const ok = await confirm({
      title: next === "admin" ? `Make ${u.name} an administrator?` : `Remove admin access from ${u.name}?`,
      description:
        next === "admin" ? "Administrators can manage all content, users and settings." : "They will become a regular reader and lose access to this dashboard.",
      confirmLabel: next === "admin" ? "Make admin" : "Make reader",
      tone: next === "admin" ? "primary" : "danger",
    });
    if (ok) await run(`${u.name} is now ${next === "admin" ? "an admin" : "a reader"}`, () => api.admin.users.update(u.id, { role: next }));
  }

  async function remove(u: AdminUser) {
    const ok = await confirm({
      title: `Delete ${u.name}?`,
      description: `${u.email} and their sessions will be permanently deleted. Their comments are anonymised. This cannot be undone.`,
      confirmLabel: "Delete user",
      tone: "danger",
    });
    if (ok) await run("User deleted", () => api.admin.users.remove(u.id));
  }

  const filtered = Boolean(q || role || state);

  return (
    <>
      <PageHeader title="Users" description="Manage roles, suspend accounts and review who has signed up." />
      <Card>
        <form
          role="search"
          aria-label="Filter users"
          onSubmit={(e) => e.preventDefault()}
          className="grid gap-3 border-b border-edge p-4 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]"
        >
          <div className="relative">
            <Input label="Search users" hideLabel type="search" placeholder="Search by name or email…" value={qText} onChange={(e) => setQText(e.target.value)} className="pl-9" autoComplete="off" />
            <LuSearch aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          </div>
          <Select label="Role" hideLabel value={role ?? ""} onChange={(e) => set({ role: e.target.value })}>
            <option value="">All roles</option>
            <option value="admin">Admins</option>
            <option value="reader">Readers</option>
          </Select>
          <Select label="Account state" hideLabel value={state} onChange={(e) => set({ state: e.target.value })}>
            <option value="">Any state</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
          </Select>
        </form>

        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <TableSkeleton rows={8} cols={5} label="Loading users" />
        ) : data.data.length === 0 ? (
          <EmptyState title={filtered ? "No users match these filters" : "No users yet"} description={filtered ? "Try a different search." : undefined} />
        ) : (
          <div aria-busy={isValidating}>
            <TableScroll label="Users">
              <Table>
                <THead>
                  <tr>
                    <Th className="w-[34%] min-w-[12rem]">User</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th>Joined</Th>
                    <Th className={`w-12 ${STICKY_ACTION_TH}`}>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {data.data.map((u) => {
                    const self = me?.id === u.id;
                    return (
                      <Tr key={u.id}>
                        <Td className="max-w-0">
                          <p className="truncate font-medium">
                            {u.name}
                            {self ? <span className="ml-2 text-xs font-normal text-muted">(you)</span> : null}
                          </p>
                          <p className="truncate text-[0.8125rem] text-muted">{u.email}</p>
                        </Td>
                        <Td>
                          <StatusBadge status={u.role} />
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1.5">
                            {u.banned ? <StatusBadge status="banned" /> : <StatusBadge status="visible" label="Active" />}
                            {!u.emailVerified ? <Badge tone="warn">Unverified</Badge> : null}
                          </div>
                          {u.banned && u.banReason ? <p className="mt-1 max-w-56 truncate text-xs text-muted" title={u.banReason}>Reason: {u.banReason}</p> : null}
                        </Td>
                        <Td className="whitespace-nowrap text-muted">{formatDate(u.createdAt)}</Td>
                        <Td className={STICKY_ACTION_TD}>
                          <DropdownMenu
                            label={`Actions for ${u.name}`}
                            triggerClassName="grid size-9 place-items-center rounded-ctl text-muted hover:bg-panel-2 hover:text-ink pointer-coarse:size-11"
                            trigger={<LuEllipsis aria-hidden className="size-5" />}
                            items={[
                              u.role === "admin"
                                ? { id: "role", label: "Make reader…", icon: <LuUserMinus className="size-4" />, onSelect: () => changeRole(u, "reader") }
                                : { id: "role", label: "Make admin…", icon: <LuShieldCheck className="size-4" />, onSelect: () => changeRole(u, "admin") },
                              u.banned
                                ? { id: "ban", label: "Unban", icon: <LuUserCheck className="size-4" />, onSelect: () => run(`${u.name} was unbanned`, () => api.admin.users.unban(u.id)) }
                                : { id: "ban", label: "Ban…", icon: <LuBan className="size-4" />, onSelect: () => setBanTarget(u) },
                              { id: "delete", label: "Delete…", icon: <LuTrash2 className="size-4" />, danger: true, separatorBefore: true, onSelect: () => remove(u) },
                            ]}
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </TableScroll>
            <Pagination meta={data.meta} onPage={(n) => set({ page: n }, { resetPage: false })} busy={isValidating} noun="users" />
          </div>
        )}
      </Card>

      <Dialog open={banTarget !== null} onClose={() => setBanTarget(null)} title={banTarget ? `Ban ${banTarget.name}` : "Ban user"} description="They are signed out immediately and cannot sign in or comment while banned." size="sm">
        {banTarget ? (
          <BanForm
            user={banTarget}
            onClose={() => setBanTarget(null)}
            onDone={async () => {
              toast.success(`${banTarget.name} was banned`);
              await mutateGroup("users", "stats");
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function BanForm({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = reason.trim();
    if (!r) return setFieldError("Enter a reason (shown to administrators only).");
    if (r.length > 500) return setFieldError("The reason can be at most 500 characters.");
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      await api.admin.users.ban(user.id, { reason: r });
      await onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>
      <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} rows={3} maxLength={520} data-autofocus />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="danger" loading={busy}>
          Ban user
        </Button>
      </div>
    </form>
  );
}
