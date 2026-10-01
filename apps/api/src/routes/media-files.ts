import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { notFound } from "../errors";
import type { Deps } from "../deps";

/** `GET /media/files/*key` — serves objects of the local/memory storage drivers (images only, hardened headers). */
export function mediaFilesRouter(deps: Deps): Router {
  const router = Router();
  router.get("/media/files/*key", async (req, res) => {
    if (!deps.storage.open) throw notFound();
    const parts = req.params.key as unknown as string[] | string;
    const key = Array.isArray(parts) ? parts.join("/") : parts;
    const obj = await deps.storage.open(key);
    if (!obj || !obj.contentType.startsWith("image/")) throw notFound();
    res.set({
      "content-type": obj.contentType,
      "content-length": String(obj.size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "inline",
    });
    await pipeline(obj.stream, res);
  });
  return router;
}
