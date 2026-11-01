import { HttpError } from "../../errors";
import type { Storage, StoredObject } from "./types";

/**
 * PLACEHOLDER for Supabase Storage (`STORAGE_DRIVER=supabase`): not written yet, uploads answer 501 (deleting is a no-op,
 * like `UnconfiguredStorage`, so removing a media row keeps working).
 *
 * Intended shape when it is: a public bucket (`SUPABASE_STORAGE_BUCKET`, default `media`) written with the service-role
 * key (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) through the Storage REST API. `put` uploads to `<bucket>/<key>` and returns
 * `<SUPABASE_URL>/storage/v1/object/public/<bucket>/<key>`, so `publicUrl` is derivable (unlike Vercel Blob). The web app
 * also needs `NEXT_PUBLIC_MEDIA_HOST` set to the project's host for `next/image`.
 */
export class SupabaseStorage implements Storage {
  readonly driver = "supabase";

  private fail(): never {
    throw new HttpError(501, "internal", "STORAGE_DRIVER=supabase is not implemented yet; use vercel-blob (Vercel) or local (docker compose).");
  }

  publicUrl(): string {
    return this.fail();
  }

  async put(): Promise<StoredObject> {
    return this.fail();
  }

  async delete(): Promise<void> {
    // nothing can have been stored here yet; deleting a media row must still work
  }
}
