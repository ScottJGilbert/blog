"use client";

import { MEDIA_MAX_BYTES, MEDIA_MIME_TYPES, MediaSchema, type Media } from "@blog/shared";
import { handleUnauthorized } from "./api";
import { formatBytes } from "./format";

/** Client-side pre-check (the server re-validates type via magic bytes and size). Returns an error message or null. */
export function validateImageFile(file: File): string | null {
  if (!(MEDIA_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `“${file.name}” is not a supported image type. Use JPEG, PNG, WebP, GIF or AVIF.`;
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return `“${file.name}” is ${formatBytes(file.size)}; the limit is ${formatBytes(MEDIA_MAX_BYTES)}.`;
  }
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

/** Multipart upload via XHR so we can report progress (`fetch` has no upload progress events). */
export function uploadMedia(
  file: File,
  opts: { alt?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<Media> {
  return new Promise<Media>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/media");
    xhr.withCredentials = true;
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Network error while uploading. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status === 401) {
        handleUnauthorized();
        reject(new Error("Your session has expired. Please sign in again."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = MediaSchema.safeParse((body as { data?: unknown } | undefined)?.data);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error("The server returned an unexpected response for the upload."));
        return;
      }
      const msg = (body as { error?: { message?: string } } | undefined)?.error?.message;
      reject(
        new Error(
          xhr.status === 413
            ? "The file is too large for the server."
            : xhr.status === 415 || xhr.status === 422 || xhr.status === 400
              ? msg || "The server rejected this file."
              : msg || `Upload failed (HTTP ${xhr.status}).`,
        ),
      );
    };
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file);
    if (opts.alt) form.append("alt", opts.alt);
    xhr.send(form);
  });
}
