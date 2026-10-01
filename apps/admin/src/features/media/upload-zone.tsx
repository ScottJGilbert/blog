"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { LuUpload } from "react-icons/lu";
import { MEDIA_MAX_BYTES, type Media } from "@blog/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { uploadMedia, validateImageFile } from "@/lib/upload";

interface Job {
  id: number;
  name: string;
  progress: number;
  error?: string;
  done?: boolean;
}

/** Drag & drop + button, multiple files, per-file progress and validation errors. */
export function UploadZone({ onUploaded, compact = false }: { onUploaded: (media: Media) => void; compact?: boolean }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [over, setOver] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const seq = useRef(0);

  function patch(id: number, p: Partial<Job>) {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));
  }

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    const newJobs: Job[] = files.map((f) => ({ id: ++seq.current, name: f.name, progress: 0 }));
    setJobs((js) => [...js.filter((j) => !j.done), ...newJobs]);
    let ok = 0;
    await Promise.all(
      files.map(async (file, i) => {
        const id = newJobs[i]!.id;
        const problem = validateImageFile(file);
        if (problem) {
          patch(id, { error: problem });
          return;
        }
        try {
          const media = await uploadMedia(file, { onProgress: (p) => patch(id, { progress: p }) });
          patch(id, { progress: 1, done: true });
          ok++;
          onUploaded(media);
        } catch (err) {
          patch(id, { error: errorMessage(err) });
        }
      }),
    );
    if (ok > 0) toast.success(ok === 1 ? "Image uploaded" : `${ok} images uploaded`);
    // successful rows disappear shortly; errors stay until the next upload
    window.setTimeout(() => setJobs((js) => js.filter((j) => !j.done)), 2500);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors",
          compact ? "py-4" : "py-8",
          over ? "border-brand bg-brand-soft" : "border-edge-strong bg-panel",
        )}
      >
        <LuUpload aria-hidden className="size-6 text-muted" />
        <p className="text-sm">
          <span className="font-medium">Drag and drop images here</span> <span className="text-muted">or</span>
        </p>
        <input
          ref={inputRef}
          id={inputId}
          aria-label="Choose image files to upload"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button variant="primary" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <p className="text-[0.8125rem] text-muted">JPEG, PNG, WebP, GIF or AVIF · up to {formatBytes(MEDIA_MAX_BYTES)} each</p>
      </div>

      {jobs.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="Uploads">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-ctl border border-edge bg-panel px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{j.name}</span>
                <span className={cn("shrink-0 text-xs", j.error ? "font-medium text-danger" : "text-muted")}>
                  {j.error ? "Failed" : j.done ? "Done" : `${Math.round(j.progress * 100)}%`}
                </span>
              </div>
              {j.error ? (
                <p role="alert" className="mt-1 text-[0.8125rem] text-danger">
                  {j.error}
                </p>
              ) : (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${j.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(j.progress * 100)}
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2"
                >
                  <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(j.progress * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
