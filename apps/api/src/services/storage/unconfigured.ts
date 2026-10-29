import { HttpError } from "../../errors";
import type { Storage, StoredObject } from "./types";

/**
 * Stand-in when no usable storage exists (Vercel without Blob: the filesystem is read-only). The API still boots and serves
 * everything else; only writes fail, with a message that names the missing setting.
 */
export class UnconfiguredStorage implements Storage {
  readonly driver = "unconfigured";

  private fail(): never {
    throw new HttpError(503, "internal", "Media storage is not configured: set BLOB_READ_WRITE_TOKEN (STORAGE_DRIVER=vercel-blob).");
  }

  publicUrl(): string {
    return this.fail();
  }

  async put(): Promise<StoredObject> {
    return this.fail();
  }

  async delete(): Promise<void> {
    // nothing could have been stored; deleting a media row must still work
  }
}
