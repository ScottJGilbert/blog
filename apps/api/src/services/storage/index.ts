import type { Config } from "../../config";
import type { Logger } from "../../logger";
import { LocalStorage } from "./local";
import { VercelBlobStorage } from "./vercel-blob";
import type { Storage } from "./types";

export * from "./types";
export { LocalStorage } from "./local";
export { MemoryStorage } from "./memory";
export { VercelBlobStorage } from "./vercel-blob";

/** `STORAGE_DRIVER=local|vercel-blob`. vercel-blob without a token degrades to local with a warning. */
export function createStorage(config: Config, logger?: Logger): Storage {
  if (config.storage.driver === "vercel-blob") {
    if (config.storage.blobToken || process.env.BLOB_READ_WRITE_TOKEN) return new VercelBlobStorage(config.storage.blobToken);
    logger?.warn("STORAGE_DRIVER=vercel-blob but BLOB_READ_WRITE_TOKEN is not set; falling back to local disk storage");
  }
  return new LocalStorage(config.storage.localDir, `${config.basePath}/media/files`);
}
