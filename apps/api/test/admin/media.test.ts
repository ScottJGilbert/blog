import { eq, auditLog, media } from "@blog/db";
import { MediaSchema } from "@blog/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../helpers";
import { avif, gif, html, jpeg, png, svg, textPretendingToBePng, webpExtended, webpLossless, webpLossy } from "../fakes/images";
import { sniffImage } from "../../src/services/media";
import { createMediaService } from "../../src/services/media";
import { API, adminSession, createPostVia, doc, type Admin } from "./helpers";

describe("sniffImage", () => {
  it("identifies every accepted format by magic bytes and reads dimensions", () => {
    expect(sniffImage(png(640, 480))).toEqual({ mime: "image/png", ext: "png", width: 640, height: 480 });
    expect(sniffImage(jpeg(1200, 800))).toEqual({ mime: "image/jpeg", ext: "jpg", width: 1200, height: 800 });
    expect(sniffImage(gif(10, 20))).toEqual({ mime: "image/gif", ext: "gif", width: 10, height: 20 });
    expect(sniffImage(webpLossless(33, 44))).toEqual({ mime: "image/webp", ext: "webp", width: 33, height: 44 });
    expect(sniffImage(webpLossy(300, 200))).toEqual({ mime: "image/webp", ext: "webp", width: 300, height: 200 });
    expect(sniffImage(webpExtended(4000, 3000))).toEqual({ mime: "image/webp", ext: "webp", width: 4000, height: 3000 });
    expect(sniffImage(avif(512, 256))).toEqual({ mime: "image/avif", ext: "avif", width: 512, height: 256 });
  });

  it("rejects svg, html, text, empty and truncated input", () => {
    for (const buf of [svg(), html(), textPretendingToBePng(), Buffer.alloc(0), Buffer.from([0xff, 0xd8]), Buffer.from("GIF89"), Buffer.from("RIFFxxxxWEBPxxxx"), Buffer.from("%PDF-1.7 hello world")]) {
      expect(sniffImage(buf)).toBeNull();
    }
  });

  it("does not crash on hostile headers (png with absurd size → null dimensions, jpeg with bogus segment length)", () => {
    const huge = png(1, 1);
    huge.writeUInt32BE(0xffffffff, 16);
    expect(sniffImage(huge)).toMatchObject({ mime: "image/png", width: null, height: null });
    const evil = jpeg(5, 5);
    evil.writeUInt16BE(0xffff, 4); // APP0 length points far beyond the buffer
    expect(sniffImage(evil)).toMatchObject({ mime: "image/jpeg", width: null, height: null });
  });
});

let t: TestApp;
let admin: Admin;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  admin = await adminSession(t);
});

const upload = (buf: Buffer, filename = "pic.png", type = "image/png", fields: Record<string, string> = {}) => {
  let req = admin.agent.post(`${API}/media`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", buf, { filename, contentType: type });
};

describe("POST /admin/media", () => {
  it("stores each accepted format under a random media/yyyy/mm key with parsed dimensions", async () => {
    const cases: Array<[Buffer, string, string]> = [
      [png(7, 5), "image/png", "png"],
      [jpeg(70, 50), "image/jpeg", "jpg"],
      [webpLossless(8, 9), "image/webp", "webp"],
      [gif(3, 4), "image/gif", "gif"],
      [avif(100, 50), "image/avif", "avif"],
    ];
    const keys = new Set<string>();
    for (const [buf, mime, ext] of cases) {
      // filename and content type lie on purpose
      const res = await upload(buf, "whatever.bin", "application/octet-stream", { alt: "  a tiny image " }).expect(201);
      const m = MediaSchema.parse(res.body.data);
      expect(m.mime).toBe(mime);
      expect(m.key).toMatch(new RegExp(`^media/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.${ext}$`));
      expect(m.url).toBe(`/api/media/files/${m.key}`);
      expect(m.sizeBytes).toBe(buf.length);
      expect(m.alt).toBe("a tiny image");
      expect(m.uploadedBy).toBe(admin.user.id);
      keys.add(m.key);
      expect(t.storage.objects.get(m.key)!.contentType).toBe(mime);
    }
    expect(keys.size).toBe(5);
    const first = [...keys][0]!;
    await admin.agent.get(`/api/media/files/${first}`).expect(200); // served by the existing files route
    const dims = await t.db.select().from(media).where(eq(media.key, [...keys][1]!));
    expect(dims[0]).toMatchObject({ width: 70, height: 50 });
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "media.upload"));
    expect(entry!.actorId).toBe(admin.user.id);
  });

  it("never uses the client filename in the key", async () => {
    const res = await upload(png(), "../../etc/passwd.png").expect(201);
    expect(res.body.data.key).not.toMatch(/passwd|\.\./);
  });

  it("rejects text/svg/html/pdf with a .png name and an image/png content type (415), storing nothing", async () => {
    for (const buf of [textPretendingToBePng(), svg(), html(), Buffer.from("%PDF-1.4 fake")]) {
      const res = await upload(buf, "evil.png", "image/png").expect(415);
      expect(res.body.error.code).toBe("validation_error");
      expect(res.body.error.message).toMatch(/Unsupported file type/);
    }
    // a real PNG declared as svg is fine (bytes decide)
    await upload(png(), "x.svg", "image/svg+xml").expect(201);
    expect(t.storage.objects.size).toBe(1);
    expect(await t.db.select().from(media)).toHaveLength(1);
  });

  it("rejects files over 8 MB with 413 (and an empty file / no file with 4xx)", async () => {
    const big = Buffer.concat([png(1, 1), Buffer.alloc(8 * 1024 * 1024 + 10)]);
    const res = await upload(big).expect(413);
    expect(res.body.error.code).toBe("validation_error");
    await upload(Buffer.alloc(0)).expect(415);
    const none = await admin.agent.post(`${API}/media`).field("alt", "no file").expect(400);
    expect(none.body.error.message).toMatch(/No file/);
    await admin.agent.post(`${API}/media`).send({ file: "nope" }).expect(400);
    expect(t.storage.objects.size).toBe(0);
  });

  it("accepts exactly one file; extra files and wrong field names are 400", async () => {
    const two = await admin.agent.post(`${API}/media`).attach("file", png(), "a.png").attach("file", png(), "b.png");
    expect(two.status).toBe(400);
    const wrong = await admin.agent.post(`${API}/media`).attach("image", png(), "a.png");
    expect(wrong.status).toBe(400);
    expect(t.storage.objects.size).toBe(0);
  });

  it("rejects a too-long alt text", async () => {
    await upload(png(), "a.png", "image/png", { alt: "x".repeat(301) }).expect(400);
  });
});

describe("list / patch / delete", () => {
  it("lists newest first with pagination", async () => {
    for (let i = 0; i < 3; i++) await upload(png(i + 1, 1)).expect(201);
    const res = await admin.agent.get(`${API}/media?pageSize=2`).expect(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(res.body.data).toHaveLength(2);
    for (const m of res.body.data) MediaSchema.parse(m);
    expect(res.body.data[0].width).toBe(3);
  });

  it("patches alt (null clears it)", async () => {
    const { body } = await upload(png()).expect(201);
    const id = body.data.id as string;
    const r = await admin.agent.patch(`${API}/media/${id}`).send({ alt: "A description" }).expect(200);
    expect(r.body.data.alt).toBe("A description");
    const cleared = await admin.agent.patch(`${API}/media/${id}`).send({ alt: null }).expect(200);
    expect(cleared.body.data.alt).toBeNull();
    await admin.agent.patch(`${API}/media/${id}`).send({ alt: "x".repeat(301) }).expect(400);
    await admin.agent.patch(`${API}/media/00000000-0000-4000-8000-000000000000`).send({ alt: "x" }).expect(404);
  });

  it("deletes row + object; 404 afterwards", async () => {
    const { body } = await upload(png()).expect(201);
    expect(t.storage.objects.size).toBe(1);
    await admin.agent.delete(`${API}/media/${body.data.id}`).expect(204);
    expect(t.storage.objects.size).toBe(0);
    expect(await t.db.select().from(media)).toHaveLength(0);
    await admin.agent.delete(`${API}/media/${body.data.id}`).expect(404);
  });

  it("refuses (409 + references) to delete an image used as a post cover or in content; ?force=true overrides", async () => {
    const { body } = await upload(png()).expect(201);
    const m = body.data as { id: string; url: string; key: string };
    const asCover = await createPostVia(admin.agent, { title: "Cover user", coverImageUrl: m.url });
    const conflict = await admin.agent.delete(`${API}/media/${m.id}`).expect(409);
    expect(conflict.body.error.code).toBe("conflict");
    expect(conflict.body.error.details.posts).toEqual([{ id: asCover.id, slug: asCover.slug, title: "Cover user" }]);
    expect(t.storage.objects.size).toBe(1);

    await admin.agent.patch(`${API}/posts/${asCover.id}`).send({ coverImageUrl: null }).expect(200);
    const inBody = await createPostVia(admin.agent, {
      title: "Body user",
      content: { root: { ...doc("x").root, children: [{ type: "image", version: 1, src: m.url, altText: "", width: 0, height: 0, maxWidth: 1, showCaption: false }] } },
    });
    const c2 = await admin.agent.delete(`${API}/media/${m.id}`).expect(409);
    expect(c2.body.error.details.posts[0].id).toBe(inBody.id);

    await admin.agent.delete(`${API}/media/${m.id}?force=true`).expect(204);
    expect(t.storage.objects.size).toBe(0);
  });
});

describe("media service limits", () => {
  it("storeObject refuses buffers over 8 MB even when called directly (editor images)", async () => {
    const svc = createMediaService(t.deps);
    const big = Buffer.concat([png(1, 1), Buffer.alloc(8 * 1024 * 1024)]);
    await expect(svc.storeObject(big)).rejects.toMatchObject({ status: 413 });
    expect(t.storage.objects.size).toBe(0);
  });
});
