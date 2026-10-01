"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { LuCheck, LuCopy, LuKey, LuPlus, LuTriangleAlert } from "react-icons/lu";
import { API_KEY_SCOPES, type ApiKey, type ApiKeyCreated, type ApiKeyScope } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Checkbox, FormError, Input } from "@/components/ui/form";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TableScroll, TBody, Td, Th, THead, Tr, STICKY_ACTION_TD, STICKY_ACTION_TH } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatRelative } from "@/lib/format";

const SCOPE_HELP: Record<ApiKeyScope, string> = {
  "posts:read": "Read published posts",
  "comments:read": "Read visible comments",
  "tags:read": "Read tags",
};

export function ApiKeysView() {
  const toast = useToast();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const { data, error, isLoading, mutate } = useSWR(["api-keys"], () => api.admin.apiKeys.list());

  async function revoke(k: ApiKey) {
    const ok = await confirm({
      title: `Revoke “${k.name}”?`,
      description: "Applications using this key will stop working immediately. This cannot be undone.",
      confirmLabel: "Revoke key",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.admin.apiKeys.revoke(k.id);
      toast.success("API key revoked");
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys for the read-only public API (/api/v1). They raise rate limits and unlock scoped data."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<LuPlus aria-hidden className="size-4" />}>
            Create key
          </Button>
        }
      />
      <Card>
        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <TableSkeleton rows={4} cols={5} label="Loading API keys" />
        ) : data.length === 0 ? (
          <EmptyState title="No API keys yet" icon={<LuKey className="size-6" />} description="Create a key to use the public API from your own applications." />
        ) : (
          <TableScroll label="API keys">
            <Table className="min-w-[44rem]">
              <THead>
                <tr>
                  <Th>Name</Th>
                  <Th>Key</Th>
                  <Th>Scopes</Th>
                  <Th>Last used</Th>
                  <Th>Status</Th>
                  <Th className={`w-24 ${STICKY_ACTION_TH}`}>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {data.map((k) => (
                  <Tr key={k.id}>
                    <Td className="font-medium">
                      {k.name}
                      <span className="block text-xs font-normal text-muted">Created {formatDate(k.createdAt)}</span>
                    </Td>
                    <Td className="font-mono text-[0.8125rem]">{k.prefix}…</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.length ? k.scopes.map((s) => <Badge key={s}>{s}</Badge>) : <span className="text-muted">None</span>}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{k.lastUsedAt ? formatRelative(k.lastUsedAt) : "Never"}</Td>
                    <Td>{k.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="ok">Active</Badge>}</Td>
                    <Td className={STICKY_ACTION_TD}>
                      {!k.revokedAt ? (
                        <Button size="sm" variant="danger-outline" onClick={() => revoke(k)} aria-label={`Revoke ${k.name}`}>
                          Revoke
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create API key" size="sm">
        {createOpen ? (
          <CreateForm
            onClose={() => setCreateOpen(false)}
            onCreated={async (k) => {
              setCreateOpen(false);
              setCreated(k);
              await mutate();
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Copy your new API key"
        size="md"
        dismissOnBackdrop={false}
        footer={
          <Button variant="primary" onClick={() => setCreated(null)} data-autofocus>
            I have saved the key
          </Button>
        }
      >
        {created ? <KeyReveal created={created} /> : null}
      </Dialog>
    </>
  );
}

function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (k: ApiKeyCreated) => Promise<void> }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["posts:read", "tags:read"]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setNameError("Give the key a name so you can recognise it later.");
    if (n.length > 80) return setNameError("The name can be at most 80 characters.");
    setNameError(null);
    setError(null);
    setBusy(true);
    try {
      await onCreated(await api.admin.apiKeys.create({ name: n, scopes }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>
      <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={nameError} placeholder="e.g. Portfolio site" maxLength={100} data-autofocus />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Scopes</legend>
        {API_KEY_SCOPES.map((s) => (
          <div key={s}>
            <Checkbox
              label={
                <span>
                  <span className="font-mono text-[0.8125rem]">{s}</span> <span className="text-muted">— {SCOPE_HELP[s]}</span>
                </span>
              }
              checked={scopes.includes(s)}
              onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
            />
          </div>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>
          Create key
        </Button>
      </div>
    </form>
  );
}

function KeyReveal({ created }: { created: ApiKeyCreated }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <div role="alert" className="flex items-start gap-2 rounded-ctl border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm text-warn">
        <LuTriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>
          <strong className="font-semibold">This is the only time the key is shown.</strong> Store it somewhere safe now; it cannot be retrieved later.
        </p>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">{created.name}</p>
        <div className="flex items-stretch gap-2">
          <input readOnly aria-label="New API key" value={created.key} onFocus={(e) => e.currentTarget.select()} className="ctl font-mono text-[0.8125rem]" />
          <Button
            onClick={async () => {
              setCopied(await copyText(created.key));
            }}
            icon={copied ? <LuCheck aria-hidden className="size-4" /> : <LuCopy aria-hidden className="size-4" />}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="sr-only" role="status">
          {copied ? "API key copied to clipboard" : ""}
        </p>
      </div>
    </div>
  );
}
