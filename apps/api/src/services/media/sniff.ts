/**
 * Magic-byte image sniffing + dimension parsing (no dependencies).
 *
 * The client-supplied mime type / filename are NEVER trusted: the type is decided by the first bytes of the file.
 * Accepted: JPEG, PNG, WebP, GIF, AVIF. Everything else (SVG, HTML, PDF, text with a `.png` name, …) → `null`.
 */
export type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif";

export interface SniffedImage {
  mime: ImageMime;
  /** file extension without dot, matching `mime` */
  ext: "jpg" | "png" | "webp" | "gif" | "avif";
  /** null when the header could not be parsed (the file is still a structurally plausible image) */
  width: number | null;
  height: number | null;
}

const EXT: Record<ImageMime, SniffedImage["ext"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const ascii = (b: Buffer, start: number, end: number): string => b.toString("latin1", start, end);

function dims(width: number, height: number): { width: number | null; height: number | null } {
  // sanity: 0 or absurd values mean the header was misparsed or hostile
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 100_000 || height > 100_000) {
    return { width: null, height: null };
  }
  return { width, height };
}

function png(b: Buffer): SniffedImage | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !sig.every((v, i) => b[i] === v)) return null;
  // first chunk MUST be IHDR (length 13)
  if (b.readUInt32BE(8) !== 13 || ascii(b, 12, 16) !== "IHDR") return null;
  return { mime: "image/png", ext: "png", ...dims(b.readUInt32BE(16), b.readUInt32BE(20)) };
}

function gif(b: Buffer): SniffedImage | null {
  if (b.length < 10) return null;
  const head = ascii(b, 0, 6);
  if (head !== "GIF87a" && head !== "GIF89a") return null;
  return { mime: "image/gif", ext: "gif", ...dims(b.readUInt16LE(6), b.readUInt16LE(8)) };
}

function jpeg(b: Buffer): SniffedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone markers
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan: no frame header found before the data
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) break;
      return { mime: "image/jpeg", ext: "jpg", ...dims(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)) };
    }
    i += 2 + len;
  }
  return { mime: "image/jpeg", ext: "jpg", width: null, height: null };
}

function webp(b: Buffer): SniffedImage | null {
  if (b.length < 16 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return null;
  const chunk = ascii(b, 12, 16);
  let d: { width: number | null; height: number | null } = { width: null, height: null };
  if (chunk === "VP8 " && b.length >= 30) {
    // lossy: frame header after the 3-byte frame tag; start code 9d 01 2a
    if (b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) d = dims(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  } else if (chunk === "VP8L" && b.length >= 25) {
    if (b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      d = dims((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
  } else if (chunk === "VP8X" && b.length >= 30) {
    d = dims(1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)));
  } else {
    return null; // RIFF/WEBP container without an image chunk
  }
  return { mime: "image/webp", ext: "webp", ...d };
}

function avif(b: Buffer): SniffedImage | null {
  if (b.length < 16 || ascii(b, 4, 8) !== "ftyp") return null;
  const boxSize = b.readUInt32BE(0);
  const end = Math.min(b.length, boxSize >= 16 ? boxSize : 32);
  const brands = [ascii(b, 8, 12)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4));
  if (!brands.some((x) => x === "avif" || x === "avis")) return null;
  // first `ispe` (image spatial extents) box: fourcc, version/flags (4), width (u32 BE), height (u32 BE)
  const idx = b.indexOf("ispe", end, "latin1");
  let d: { width: number | null; height: number | null } = { width: null, height: null };
  if (idx >= 0 && idx + 16 <= b.length) d = dims(b.readUInt32BE(idx + 8), b.readUInt32BE(idx + 12));
  return { mime: "image/avif", ext: "avif", ...d };
}

/** Identify an image by magic bytes and read its pixel size. `null` = not an accepted image type. */
export function sniffImage(buf: Buffer): SniffedImage | null {
  if (buf.length < 12) return null;
  try {
    return png(buf) ?? jpeg(buf) ?? gif(buf) ?? webp(buf) ?? avif(buf);
  } catch {
    return null;
  }
}

export const extensionFor = (mime: ImageMime): SniffedImage["ext"] => EXT[mime];
