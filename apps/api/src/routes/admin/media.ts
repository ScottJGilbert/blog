import { ListMediaQuerySchema, MEDIA_MAX_BYTES, UpdateMediaInputSchema, UploadMediaFieldsSchema } from "@blog/shared";
import { type NextFunction, type Request, type Response, Router } from "express";
import multer from "multer";
import type { Deps } from "../../deps";
import { HttpError, badRequest, conflict } from "../../errors";
import { audit } from "../../lib/audit";
import { ok, paginated } from "../../lib/pagination";
import { parseBody, parseQuery } from "../../lib/validate";
import { actorOf, uuidParam } from "../../services/admin/common";
import { ImageTooLargeError, createMediaService, toMediaDto } from "../../services/media";

/** multipart parser: memory storage, ONE file of at most 8 MB in the field `file`, a handful of small text fields. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 5, fieldSize: 4096, parts: 8, headerPairs: 50 },
});

function receiveFile(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new ImageTooLargeError());
      return next(badRequest(`Invalid upload: ${err.message}`));
    }
    // busboy parse errors (truncated/malformed multipart bodies)
    if (err instanceof Error && !(err instanceof HttpError)) return next(badRequest("Malformed multipart upload"));
    next(err);
  });
}

/**
 * `/admin/media`. Upload: `multipart/form-data`, field `file` (+ optional `alt`). The type is decided by magic bytes
 * (jpeg/png/webp/gif/avif); client mime type and filename are ignored. Status codes: 400 no/invalid file, 413 too large,
 * 415 unsupported type.
 *
 * Delete: refuses with **409** (details list the referencing posts/newsletters) while the image is used as a post cover,
 * inside post content or in a newsletter; `?force=true` deletes anyway.
 */
export function adminMediaRouter(deps: Deps): Router {
  const router = Router();
  const media = createMediaService(deps);

  router.get("/media", async (req, res) => {
    const q = parseQuery(ListMediaQuerySchema, req);
    const { items, total } = await media.list(q);
    paginated(res, { data: items.map(toMediaDto), total, page: q.page, pageSize: q.pageSize });
  });

  router.post("/media", receiveFile, async (req, res) => {
    const actor = actorOf(req);
    if (!req.file) throw badRequest("No file uploaded: send multipart/form-data with the image in the field 'file'");
    const fields = UploadMediaFieldsSchema.parse({ alt: typeof req.body?.alt === "string" ? req.body.alt : undefined });
    const row = await media.upload(req.file.buffer, { alt: fields.alt || null, uploadedBy: actor.id });
    await audit(deps.db, actor, { action: "media.upload", targetType: "media", targetId: row.id, meta: { key: row.key, mime: row.mime, sizeBytes: row.sizeBytes } });
    ok(res, toMediaDto(row), 201);
  });

  router.patch("/media/:id", async (req, res) => {
    const actor = actorOf(req);
    const id = uuidParam(req);
    const input = parseBody(UpdateMediaInputSchema, req);
    const existing = await media.get(id);
    const row = await media.setAlt(id, input.alt || null);
    await audit(deps.db, actor, { action: "media.update", targetType: "media", targetId: id, meta: { key: existing.key } });
    ok(res, toMediaDto(row));
  });

  router.delete("/media/:id", async (req, res) => {
    const actor = actorOf(req);
    const row = await media.get(uuidParam(req));
    const force = ["1", "true", "yes"].includes(String(req.query.force ?? "").toLowerCase());
    if (!force) {
      const refs = await media.references(row);
      if (refs.posts.length > 0 || refs.newsletters.length > 0) {
        throw conflict("This image is still used by posts or newsletters. Remove it there first, or delete with ?force=true.", refs);
      }
    }
    await media.remove(row);
    await audit(deps.db, actor, { action: "media.delete", targetType: "media", targetId: row.id, meta: { key: row.key, forced: force } });
    res.status(204).end();
  });

  return router;
}
