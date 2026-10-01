import type { Readable } from "node:stream";

export interface StoredObject {
  /** Storage key (what is persisted in `media.key`). */
  key: string;
  /** Public URL (what is persisted in `media.url`). */
  url: string;
}

export interface Storage {
  readonly driver: "local" | "vercel-blob" | "memory";
  /** Store `body` under `key`. Keys are chosen by the caller (random, unguessable, no `..`). */
  put(key: string, body: Buffer, opts: { contentType: string }): Promise<StoredObject>;
  /** Delete by key. Missing objects are not an error. */
  delete(key: string): Promise<void>;
  /** Public URL for a key. */
  publicUrl(key: string): string;
  /** Local/memory drivers only: open an object for serving by the API. */
  open?(key: string): Promise<{ stream: Readable; size: number; contentType: string } | null>;
}

export const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function assertSafeKey(key: string): void {
  if (key.length > 200 || !SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
}
