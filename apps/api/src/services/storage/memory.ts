import { Readable } from "node:stream";
import { assertSafeKey, type Storage, type StoredObject } from "./types";

/** In-memory storage for tests. */
export class MemoryStorage implements Storage {
  readonly driver = "memory";
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  constructor(private readonly publicBase = "/api/media/files") {}

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<StoredObject> {
    assertSafeKey(key);
    this.objects.set(key, { body, contentType: opts.contentType });
    return { key, url: this.publicUrl(key) };
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async open(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return { stream: Readable.from(o.body), size: o.body.length, contentType: o.contentType };
  }
}
