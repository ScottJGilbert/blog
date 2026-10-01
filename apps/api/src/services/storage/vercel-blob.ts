import { del, put } from "@vercel/blob";
import { assertSafeKey, type Storage, type StoredObject } from "./types";

/** Vercel Blob (public access). `token` falls back to the BLOB_READ_WRITE_TOKEN env the SDK reads itself. */
export class VercelBlobStorage implements Storage {
  readonly driver = "vercel-blob";

  constructor(private readonly token?: string) {}

  publicUrl(): string {
    throw new Error("Vercel Blob URLs are assigned on upload; use the url returned by put()");
  }

  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<StoredObject> {
    assertSafeKey(key);
    const res = await put(key, body, {
      access: "public",
      contentType: opts.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      ...(this.token ? { token: this.token } : {}),
    });
    return { key, url: res.url };
  }

  async delete(key: string): Promise<void> {
    await del(key, this.token ? { token: this.token } : undefined);
  }
}
