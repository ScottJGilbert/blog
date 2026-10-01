import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type Storage, type StoredObject } from "./types";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/** Files on local disk (dev/test). Served by the API at `<basePath>/media/files/<key>`. */
export class LocalStorage implements Storage {
  readonly driver = "local";
  private readonly root: string;

  constructor(
    dir: string,
    private readonly publicBase: string,
  ) {
    this.root = path.resolve(dir);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error("Unsafe storage key");
    return full;
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async put(key: string, body: Buffer, _opts: { contentType: string }): Promise<StoredObject> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    return { key, url: this.publicUrl(key) };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async open(key: string) {
    let file: string;
    try {
      file = this.resolve(key);
    } catch {
      return null;
    }
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) return null;
    return {
      stream: createReadStream(file),
      size: s.size,
      contentType: TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    };
  }
}
