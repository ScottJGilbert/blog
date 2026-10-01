"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { LuCopy, LuPencil, LuTrash2 } from "react-icons/lu";
import type { Media } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { errorMessage } from "@/lib/errors";
import { formatBytes, formatDate } from "@/lib/format";
import { useGroupMutate } from "@/lib/use-group-mutate";
import { useQueryState } from "@/lib/use-query-state";
import { MediaImage } from "./media-image";
import { UploadZone } from "./upload-zone";

const PAGE_SIZE = 24;

export function MediaView() {
  const { page, set } = useQueryState([] as const);
  const toast = useToast();
  const confirm = useConfirm();
  const mutateGroup = useGroupMutate();
  const [editing, setEditing] = useState<Media | null>(null);
  const { data, error, isLoading, mutate } = useSWR(["media", { page }], () => api.admin.media.list({ page, pageSize: PAGE_SIZE }));

  async function copy(m: Media) {
    const abs = new URL(m.url, window.location.origin).href;
    if (await copyText(abs)) toast.success("Image URL copied");
    else toast.error("Could not copy automatically. Open the image details and copy the URL manually.");
  }

  async function remove(m: Media) {
    const ok = await confirm({
      title: "Delete this image?",
      description: "Posts that still use it will show a broken image. This cannot be undone.",
      confirmLabel: "Delete image",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.admin.media.remove(m.id);
      toast.success("Image deleted");
      setEditing(null);
      await mutate();
      await mutateGroup("media");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader title="Media" description="Upload and manage images used in posts and newsletters." />
      <div className="mb-5">
        <UploadZone
          onUploaded={() => {
            void mutate();
            void mutateGroup("media");
          }}
        />
      </div>

      <Card aria-labelledby="library-h">
        <h2 id="library-h" className="border-b border-edge px-4 py-3 text-sm font-semibold">
          Library
        </h2>
        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <div role="status" aria-busy="true" className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <span className="sr-only">Loading media…</span>
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3.6]" />
            ))}
          </div>
        ) : data.data.length === 0 ? (
          <EmptyState title="No images yet" description="Upload your first image with the area above." />
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {data.data.map((m) => (
                <li key={m.id} className="overflow-hidden rounded-lg border border-edge bg-panel">
                  <button
                    type="button"
                    onClick={() => setEditing(m)}
                    aria-label={`Edit details for ${m.alt || m.key}`}
                    className="block aspect-[4/3] w-full overflow-hidden bg-panel-2"
                  >
                    <MediaImage media={m} sizes="(max-width: 640px) 50vw, 220px" />
                  </button>
                  <div className="space-y-1 p-2.5">
                    <p className="truncate text-[0.8125rem] font-medium" title={m.alt || m.key}>
                      {m.alt || <span className="text-muted">No alt text</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {formatBytes(m.sizeBytes)}
                      {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
                    </p>
                    <div className="flex items-center justify-end gap-0.5 pt-0.5">
                      <IconButton size="sm" label={`Edit alt text for ${m.alt || m.key}`} onClick={() => setEditing(m)}>
                        <LuPencil aria-hidden className="size-4" />
                      </IconButton>
                      <IconButton size="sm" label={`Copy URL of ${m.alt || m.key}`} onClick={() => copy(m)}>
                        <LuCopy aria-hidden className="size-4" />
                      </IconButton>
                      <IconButton size="sm" label={`Delete ${m.alt || m.key}`} onClick={() => remove(m)}>
                        <LuTrash2 aria-hidden className="size-4 text-danger" />
                      </IconButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination meta={data.meta} onPage={(n) => set({ page: n }, { resetPage: false })} noun="images" />
          </>
        )}
      </Card>

      <MediaDetails
        media={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          await mutate();
          await mutateGroup("media");
        }}
        onDelete={remove}
        onCopy={copy}
      />
    </>
  );
}

function MediaDetails({
  media,
  onClose,
  onSaved,
  onDelete,
  onCopy,
}: {
  media: Media | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDelete: (m: Media) => void;
  onCopy: (m: Media) => void;
}) {
  return (
    <Dialog open={media !== null} onClose={onClose} title="Image details" size="lg">
      {media ? <DetailsForm key={media.id} media={media} onClose={onClose} onSaved={onSaved} onDelete={onDelete} onCopy={onCopy} /> : null}
    </Dialog>
  );
}

function DetailsForm({
  media,
  onClose,
  onSaved,
  onDelete,
  onCopy,
}: {
  media: Media;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDelete: (m: Media) => void;
  onCopy: (m: Media) => void;
}) {
  const toast = useToast();
  const [alt, setAlt] = useState(media.alt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (alt.trim().length > 300) {
      setError("Alt text can be at most 300 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.admin.media.update(media.id, { alt: alt.trim() || null });
      toast.success("Alt text saved");
      await onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" noValidate>
      <div className="overflow-hidden rounded-lg border border-edge bg-panel-2">
        <MediaImage media={media} className="max-h-[60vh] object-contain" sizes="(max-width: 768px) 100vw, 400px" />
      </div>
      <div className="space-y-4">
        <Input
          label="Alt text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          error={error}
          hint="Describes the image for people who cannot see it."
          maxLength={320}
          data-autofocus
        />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
          <dt className="text-muted">Type</dt>
          <dd>{media.mime}</dd>
          <dt className="text-muted">Size</dt>
          <dd>{formatBytes(media.sizeBytes)}</dd>
          {media.width && media.height ? (
            <>
              <dt className="text-muted">Dimensions</dt>
              <dd>
                {media.width} × {media.height}
              </dd>
            </>
          ) : null}
          <dt className="text-muted">Uploaded</dt>
          <dd>{formatDate(media.createdAt)}</dd>
          <dt className="text-muted">URL</dt>
          <dd className="break-all font-mono text-xs">{media.url}</dd>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="submit" variant="primary" loading={busy}>
            Save alt text
          </Button>
          <Button onClick={() => onCopy(media)} icon={<LuCopy aria-hidden className="size-4" />}>
            Copy URL
          </Button>
          <Button variant="danger-outline" onClick={() => onDelete(media)} icon={<LuTrash2 aria-hidden className="size-4" />}>
            Delete
          </Button>
        </div>
      </div>
    </form>
  );
}
