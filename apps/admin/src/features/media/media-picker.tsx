"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Media } from "@blog/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useGroupMutate } from "@/lib/use-group-mutate";
import { MediaImage } from "./media-image";
import { UploadZone } from "./upload-zone";

/** Dialog to pick an existing image from the library or upload a new one. */
export function MediaPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (media: Media) => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Media | null>(null);
  const mutateGroup = useGroupMutate();
  const { data, error, isLoading, mutate } = useSWR(open ? ["media", { page, picker: true }] : null, () =>
    api.admin.media.list({ page, pageSize: 24 }),
  );

  function pick(m: Media) {
    onPick(m);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose an image"
      description="Select an image from your library or upload a new one."
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected} onClick={() => selected && pick(selected)}>
            Use selected image
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <UploadZone
          compact
          onUploaded={(m) => {
            setSelected(m);
            setPage(1);
            void mutate();
            void mutateGroup("media");
          }}
        />
        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <div role="status" aria-busy="true" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <span className="sr-only">Loading media…</span>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        ) : data.data.length === 0 ? (
          <EmptyState title="No images yet" description="Upload an image above to get started." />
        ) : (
          <>
            <ul role="listbox" aria-label="Media library" aria-multiselectable="false" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.data.map((m) => {
                const isSel = selected?.id === m.id;
                return (
                  <li key={m.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      onClick={() => setSelected(m)}
                      onDoubleClick={() => pick(m)}
                      className={cn(
                        "group block w-full overflow-hidden rounded-lg border-2 text-left",
                        isSel ? "border-brand ring-2 ring-brand/30" : "border-edge hover:border-edge-strong",
                      )}
                    >
                      <span className="block aspect-[4/3] bg-panel-2">
                        <MediaImage media={m} sizes="(max-width: 640px) 50vw, 200px" />
                      </span>
                      <span className="block truncate px-2 py-1.5 text-xs text-muted">{m.alt || m.key}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {data.meta.totalPages > 1 ? (
              <div className="flex items-center justify-between text-sm">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span className="text-muted">
                  Page {data.meta.page} of {data.meta.totalPages}
                </span>
                <Button size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
