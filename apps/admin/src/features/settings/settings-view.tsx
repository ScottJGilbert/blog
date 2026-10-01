"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { LuDatabase, LuHardDrive, LuMail, LuNewspaper, LuRefreshCw, LuSparkles } from "react-icons/lu";
import { Card, PageHeader } from "@/components/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { CardSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

function Row({ icon, title, status, tone, children }: { icon: ReactNode; title: string; status: string; tone: Tone; children?: ReactNode }) {
  return (
    <Card as="div" className="flex items-start gap-3 p-4">
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Badge tone={tone}>{status}</Badge>
        </div>
        <div className="mt-1 text-[0.8125rem] text-muted">{children}</div>
      </div>
    </Card>
  );
}

export function SettingsView() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(["system"], () => api.admin.system());

  async function reindex() {
    setBusy(true);
    try {
      const r = await api.admin.embeddings.reindex();
      if (!r.enabled) toast.info("Embeddings are disabled (EMBEDDING_API_KEY is not set).");
      else toast.success(`Re-embedding started for ${r.queued} ${r.queued === 1 ? "post" : "posts"}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Read-only system health. Integrations are configured through environment variables."
        actions={
          <Button onClick={() => mutate()} icon={<LuRefreshCw aria-hidden className="size-4" />}>
            Refresh
          </Button>
        }
      />
      {error && !data ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        </Card>
      ) : isLoading || !data ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <CardSkeleton key={i} className="h-24" label="Loading system health" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Row icon={<LuDatabase className="size-5" />} title="Database" status={data.db === "up" ? "Operational" : "Down"} tone={data.db === "up" ? "ok" : "danger"}>
            PostgreSQL connection is {data.db}.
          </Row>
          <Row icon={<LuMail className="size-5" />} title="Transactional email" status={data.mailer === "console" || data.mailer === "memory" ? "Not delivering" : "Configured"} tone={data.mailer === "console" || data.mailer === "memory" ? "warn" : "ok"}>
            Driver: <code className="font-mono">{data.mailer}</code>
            {data.mailer === "console" ? " — emails are only logged. Set MAILER_DRIVER to smtp or resend." : null}
          </Row>
          <Row icon={<LuHardDrive className="size-5" />} title="Media storage" status="Active" tone="ok">
            Driver: <code className="font-mono">{data.storage}</code>
            {data.storage === "local" ? " — files live on local disk (development)." : null}
          </Row>
          <Row icon={<LuSparkles className="size-5" />} title="Embeddings" status={data.embeddings.enabled ? "Enabled" : "Disabled"} tone={data.embeddings.enabled ? "ok" : "neutral"}>
            <p>
              Model: <code className="font-mono">{data.embeddings.model}</code>
              {!data.embeddings.enabled ? " — set EMBEDDING_API_KEY to enable semantic search and related posts." : null}
            </p>
            <div className="mt-2">
              <Button size="sm" onClick={reindex} loading={busy} disabled={!data.embeddings.enabled}>
                Reindex all posts
              </Button>
            </div>
          </Row>
          <Row
            icon={<LuNewspaper className="size-5" />}
            title="Newsletter provider"
            status={data.newsletter.configured ? "Connected" : "Not configured"}
            tone={data.newsletter.configured ? "ok" : "warn"}
          >
            Provider: <code className="font-mono">{data.newsletter.provider}</code>
            {!data.newsletter.configured ? " — set LISTMONK_URL and credentials. Until then newsletters cannot be delivered." : null}
          </Row>
          <Card as="div" className="p-4 text-[0.8125rem] text-muted">
            <h2 className="mb-1 text-sm font-semibold text-ink">Version</h2>
            API build <code className="font-mono">{data.version}</code>
          </Card>
        </div>
      )}
    </>
  );
}
