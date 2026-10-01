/**
 * Tiny but structurally real image buffers for upload tests (headers are byte-exact; pixel data is minimal).
 * Every builder takes the pixel size it should report so the dimension parsers can be asserted.
 */
import { crc32, deflateSync } from "node:zlib";

const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u16be = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};

function pngChunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "latin1");
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))]);
}

/** A PNG with a real IHDR/IDAT/IEND (all-zero 8-bit RGB rows, deflate-compressed). */
export function png(width = 1, height = 1): Buffer {
  const ihdr = Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0])]);
  // zlib stream for `height` rows of (filter byte + 3*width zero bytes)
  const raw = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** JFIF JPEG skeleton: SOI, APP0, SOF0 (size), SOS + a few entropy bytes, EOI. */
export function jpeg(width = 1, height = 1): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), u16be(16), Buffer.from("JFIF\0", "latin1"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  const sof0 = Buffer.concat([Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  const sos = Buffer.concat([Buffer.from([0xff, 0xda]), u16be(12), Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), Buffer.from([0x12, 0x34, 0x56])]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, sos, Buffer.from([0xff, 0xd9])]);
}

export function gif(width = 1, height = 1): Buffer {
  const head = Buffer.from("GIF89a", "latin1");
  const dims = Buffer.alloc(4);
  dims.writeUInt16LE(width, 0);
  dims.writeUInt16LE(height, 2);
  return Buffer.concat([head, dims, Buffer.from([0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff]), Buffer.from([0x2c, 0, 0, 0, 0]), dims, Buffer.from([0, 2, 2, 0x44, 1, 0, 0x3b])]);
}

function riff(chunks: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), size, body]);
}
function webpChunk(fourcc: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(fourcc, "latin1"), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** Lossless WebP (`VP8L`). */
export function webpLossless(width = 1, height = 1): Buffer {
  const bits = Buffer.alloc(4);
  bits.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14));
  return riff(webpChunk("VP8L", Buffer.concat([Buffer.from([0x2f]), bits, Buffer.from([0, 0, 0, 0])])));
}

/** Lossy WebP (`VP8 `): frame tag + start code + 14-bit dimensions. */
export function webpLossy(width = 1, height = 1): Buffer {
  const dims = Buffer.alloc(4);
  dims.writeUInt16LE(width & 0x3fff, 0);
  dims.writeUInt16LE(height & 0x3fff, 2);
  return riff(webpChunk("VP8 ", Buffer.concat([Buffer.from([0x10, 0x02, 0x00]), Buffer.from([0x9d, 0x01, 0x2a]), dims, Buffer.alloc(8)])));
}

/** Extended WebP (`VP8X`): canvas size minus one, 24-bit little endian. */
export function webpExtended(width = 1, height = 1): Buffer {
  const d = Buffer.alloc(10);
  d.writeUIntLE(width - 1, 4, 3);
  d.writeUIntLE(height - 1, 7, 3);
  return riff(webpChunk("VP8X", d));
}

const box = (type: string, payload: Buffer) => Buffer.concat([u32be(8 + payload.length), Buffer.from(type, "latin1"), payload]);

/** AVIF skeleton: `ftyp(avif)` + `meta` containing an `ispe` box. */
export function avif(width = 1, height = 1): Buffer {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("avif", "latin1"), u32be(0), Buffer.from("avifmif1", "latin1")]));
  const ispe = box("ispe", Buffer.concat([u32be(0), u32be(width), u32be(height)]));
  const meta = box("meta", Buffer.concat([u32be(0), box("iprp", box("ipco", ispe))]));
  return Buffer.concat([ftyp, meta, box("mdat", Buffer.alloc(4))]);
}

export const svg = (): Buffer => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>');
export const html = (): Buffer => Buffer.from("<!doctype html><script>alert(1)</script>");
export const textPretendingToBePng = (): Buffer => Buffer.from("this is definitely not a png, just text with a .png name");

export const dataUri = (buf: Buffer, mime: string): string => `data:${mime};base64,${buf.toString("base64")}`;
