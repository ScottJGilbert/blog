import { createHash, randomUUID } from "node:crypto";
import { count, desc, eq, media, newsletter, or, post, sql, type DbOrTx } from "@blog/db";
import { MEDIA_MAX_BYTES, type Media } from "@blog/shared";
import type { Deps } from "../../deps";
import { HttpError, notFound } from "../../errors";
import { sniffImage, type ImageMime } from "./sniff";

export * from "./sniff";

export interface StoredFile {
  key: string;
  url: string;
  mime: ImageMime;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export type MediaRow = typeof media.$inferSelect;

export function toMediaDto(row: MediaRow): Media {
  return {
    id: row.id,
    key: row.key,
    url: row.url,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    alt: row.alt,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export class UnsupportedImageError extends HttpError {
  constructor(message = "Unsupported file type. Upload a JPEG, PNG, WebP, GIF or AVIF image.") {
    super(415, "validation_error", message);
  }
}

export class ImageDimensionsError extends HttpError {
  constructor(message = "Image dimensions are too large (max 16384 px per side and 100 megapixels).") {
    super(422, "validation_error", message);
  }
}

export class ImageTooLargeError extends HttpError {
  constructor(max = MEDIA_MAX_BYTES) {
    super(413, "validation_error", `Image is too large (max ${Math.round(max / 1024 / 1024)} MB).`);
  }
}

const DATA_URI = /^data:(image\/[a-z0-9.+-]+)(;[a-z0-9=._-]+)*;base64,([A-Za-z0-9+/\s]*={0,2})$/i;

export interface ExternalizeResult {
  /** Content with every `data:image/*` image source replaced by its stored URL (same object when nothing changed). */
  content: unknown;
  /** Objects written to storage (their `media` rows are NOT inserted yet: pass them to `insertMediaRows`). */
  files: Array<StoredFile & { alt: string | null }>;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Collect every image node (including those inside image captions) of a Lexical document. */
function collectImageNodes(root: unknown): Json[] {
  const out: Json[] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const n = stack.pop();
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    if (!isObj(n)) continue;
    if (n.type === "image") out.push(n);
    if (Array.isArray(n.children)) stack.push(n.children);
    const cap = n.caption;
    if (isObj(cap) && isObj(cap.editorState)) stack.push(cap.editorState.root);
    if (n.root) stack.push(n.root);
  }
  return out;
}

const isDataSrc = (n: Json): boolean => typeof n.src === "string" && /^data:image\//i.test(n.src);

export const hasDataImages = (content: unknown): boolean => collectImageNodes(content).some(isDataSrc);

export function createMediaService(deps: Deps) {
  const { db, storage } = deps;

  /** Validate (type sniffing, size) and write a buffer to storage under a random key. No DB row. */
  async function storeObject(buf: Buffer): Promise<StoredFile> {
    if (buf.length === 0) throw new UnsupportedImageError("The uploaded file is empty.");
    if (buf.length > MEDIA_MAX_BYTES) throw new ImageTooLargeError();
    const sniffed = sniffImage(buf);
    if (!sniffed) throw new UnsupportedImageError();
    if (sniffed.oversized) throw new ImageDimensionsError();
    const now = deps.now();
    const key = `media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${sniffed.ext}`;
    const stored = await storage.put(key, buf, { contentType: sniffed.mime });
    return { key: stored.key, url: stored.url, mime: sniffed.mime, sizeBytes: buf.length, width: sniffed.width, height: sniffed.height };
  }

  async function discard(files: Array<{ key: string }>): Promise<void> {
    await Promise.allSettled(files.map((f) => storage.delete(f.key)));
  }

  async function insertMediaRows(tx: DbOrTx, files: ExternalizeResult["files"], uploadedBy: string | null): Promise<MediaRow[]> {
    if (files.length === 0) return [];
    return tx
      .insert(media)
      .values(
        files.map((f) => ({
          key: f.key,
          url: f.url,
          mime: f.mime,
          sizeBytes: f.sizeBytes,
          width: f.width,
          height: f.height,
          alt: f.alt,
          uploadedBy,
        })),
      )
      .returning();
  }

  return {
    storeObject,
    discard,
    insertMediaRows,

    /** Upload one image and create its `media` row. */
    async upload(buf: Buffer, opts: { alt?: string | null; uploadedBy: string | null; tx?: DbOrTx }): Promise<MediaRow> {
      const file = await storeObject(buf);
      try {
        const [row] = await insertMediaRows(opts.tx ?? db, [{ ...file, alt: opts.alt || null }], opts.uploadedBy);
        return row!;
      } catch (err) {
        await discard([file]);
        throw err;
      }
    },

    async list(page: { page: number; pageSize: number }): Promise<{ items: MediaRow[]; total: number }> {
      const [items, [totals]] = await Promise.all([
        db
          .select()
          .from(media)
          .orderBy(desc(media.createdAt), desc(media.id))
          .limit(page.pageSize)
          .offset((page.page - 1) * page.pageSize),
        db.select({ n: count() }).from(media),
      ]);
      return { items, total: totals?.n ?? 0 };
    },

    async get(id: string): Promise<MediaRow> {
      const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
      if (!row) throw notFound("Media not found");
      return row;
    },

    /** Posts (cover or body) and newsletters that use this media URL. */
    async references(row: Pick<MediaRow, "url">): Promise<{ posts: Array<{ id: string; slug: string; title: string }>; newsletters: Array<{ id: string; subject: string }> }> {
      const needle = row.url;
      const [posts, newsletters] = await Promise.all([
        db
          .select({ id: post.id, slug: post.slug, title: post.title })
          .from(post)
          .where(or(eq(post.coverImageUrl, needle), sql`position(${needle} in ${post.content}::text) > 0`))
          .limit(10),
        db
          .select({ id: newsletter.id, subject: newsletter.subject })
          .from(newsletter)
          .where(sql`position(${needle} in ${newsletter.content}::text) > 0`)
          .limit(10),
      ]);
      return { posts, newsletters };
    },

    /**
     * Find `data:image/*` image sources in a Lexical document, store them as media objects and rewrite the `src`.
     * Idempotent (content without data URIs is returned untouched) and de-duplicating (identical bytes → one object).
     * On any failure everything stored so far is deleted again and a 422 with per-image details is thrown.
     */
    async externalizeDataImages(content: unknown): Promise<ExternalizeResult> {
      if (!hasDataImages(content)) return { content, files: [] };
      const clone = structuredClone(content);
      const nodes = collectImageNodes(clone).filter(isDataSrc);
      const byHash = new Map<string, StoredFile>();
      const files: ExternalizeResult["files"] = [];
      const problems: Array<{ index: number; message: string }> = [];

      for (const [index, node] of nodes.entries()) {
        const src = node.src as string;
        const m = DATA_URI.exec(src.trim());
        if (!m) {
          problems.push({ index, message: "Image data URI must be base64 encoded (data:image/<type>;base64,…)" });
          continue;
        }
        try {
          const buf = Buffer.from(m[3]!.replace(/\s+/g, ""), "base64");
          const hash = createHash("sha256").update(buf).digest("hex");
          let file = byHash.get(hash);
          if (!file) {
            file = await storeObject(buf);
            byHash.set(hash, file);
            files.push({ ...file, alt: typeof node.altText === "string" && node.altText ? node.altText.slice(0, 300) : null });
          }
          node.src = file.url;
        } catch (err) {
          if (err instanceof HttpError) problems.push({ index, message: err.message });
          else {
            await discard(files);
            throw err;
          }
        }
      }

      if (problems.length > 0) {
        await discard(files);
        throw new HttpError(422, "validation_error", "Some embedded images could not be stored", {
          details: problems.map((p) => ({ path: ["content", "images", p.index], message: p.message })),
        });
      }
      return { content: clone, files };
    },

    async setAlt(id: string, alt: string | null): Promise<MediaRow> {
      const [row] = await db.update(media).set({ alt }).where(eq(media.id, id)).returning();
      if (!row) throw notFound("Media not found");
      return row;
    },

    /** Delete the row and the stored object. */
    async remove(row: MediaRow): Promise<void> {
      await db.delete(media).where(eq(media.id, row.id));
      await storage.delete(row.key);
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;
