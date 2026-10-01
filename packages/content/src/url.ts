/**
 * URL allowlisting and embed URL construction. Pure string logic (uses the WHATWG `URL` class only for
 * resolution against `baseUrl`, which exists in Node, browsers, Deno, Bun and edge runtimes).
 */
import { ALLOWED_LINK_SCHEMES, CONTENT_LIMITS, EMBED_HOSTS } from "./constants";

// Browsers strip ASCII tab/newline anywhere in a URL; other control / invisible characters are rejected outright.
// eslint-disable-next-line no-control-regex
const REJECT_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\uFEFF]/;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/]+=*$/i;

export type SafeUrlKind = "absolute" | "relative" | "fragment" | "mailto" | "tel" | "data-image";

export interface SafeUrl {
  /** URL to put into the attribute (trimmed; resolved against `baseUrl` when asked to). */
  href: string;
  kind: SafeUrlKind;
  /** true for http(s) URLs that leave the site (different origin than `baseUrl`, or no baseUrl given) */
  external: boolean;
}

export interface SanitizeUrlOptions {
  baseUrl?: string;
  /** Resolve relative URLs against `baseUrl` (email/rss). */
  absolute?: boolean;
  /** Allow `data:image/{png,jpeg,gif,webp,avif};base64,…` (images only). */
  allowDataImage?: boolean;
  schemes?: readonly string[];
}

function encodeSpaces(u: string): string {
  return u.replace(/ /g, "%20");
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Validate a URL from content. Returns null when the URL is unsafe or empty.
 * Allowed: http, https, mailto, tel; same-site relative references (`/x`, `x/y`, `./x`, `../x`, `?q`, `#f`);
 * protocol-relative `//host` is upgraded to `https://host`.
 * Everything else (javascript:, data:, vbscript:, file:, blob:, ftp:, custom schemes, backslash tricks) is rejected.
 */
export function sanitizeUrl(input: unknown, opts: SanitizeUrlOptions = {}): SafeUrl | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (REJECT_CHARS.test(trimmed)) return null;
  // what the browser will actually parse
  const cleaned = trimmed.replace(/[\t\n\r]/g, "");
  if (cleaned === "") return null;
  if (/^data:/i.test(cleaned)) {
    if (opts.allowDataImage && cleaned.length <= CONTENT_LIMITS.maxDataUriLength && DATA_IMAGE.test(cleaned)) {
      return { href: cleaned, kind: "data-image", external: false };
    }
    return null;
  }
  if (cleaned.length > CONTENT_LIMITS.maxUrlLength) return null;
  // Browsers treat backslashes like slashes for http(s) (`https://evil.com\@good.com`, `/\evil.com`): reject.
  if ((cleaned.split(/[?#]/)[0] ?? "").includes("\\")) return null;

  const schemes = opts.schemes ?? ALLOWED_LINK_SCHEMES;
  const m = SCHEME.exec(cleaned);
  if (m) {
    const scheme = m[1]!.toLowerCase();
    if (!schemes.includes(scheme)) return null;
    if (scheme === "http" || scheme === "https") {
      // must have an authority
      if (!/^https?:\/\/[^/\s?#]+/i.test(cleaned)) return null;
      let external = true;
      if (opts.baseUrl) {
        const o = originOf(opts.baseUrl);
        external = !(o && originOf(cleaned) === o);
      }
      return { href: encodeSpaces(cleaned), kind: "absolute", external };
    }
    if (scheme === "mailto") {
      if (cleaned.length <= "mailto:".length) return null;
      return { href: cleaned, kind: "mailto", external: false };
    }
    if (scheme === "tel") {
      if (!/^tel:[+\d\s().;=a-z-]{1,64}$/i.test(cleaned)) return null;
      return { href: cleaned, kind: "tel", external: false };
    }
    return null;
  }

  // scheme-less
  // The editor stores what the author typed ("www.example.com"): treat bare www. hosts as https.
  if (/^www\.[^\s/?#]+\.[a-z]{2,}(?:[/?#]|$)/i.test(cleaned)) {
    return sanitizeUrl(`https://${cleaned}`, opts);
  }
  if (cleaned.startsWith("//")) {
    // protocol-relative → treat as external https
    const abs = `https:${cleaned}`;
    if (!/^https:\/\/[^/\s?#]+/.test(abs)) return null;
    let external = true;
    if (opts.baseUrl) {
      const o = originOf(opts.baseUrl);
      external = !(o && originOf(abs) === o);
    }
    return { href: abs, kind: "absolute", external };
  }
  // a colon before the first slash/?/# means "scheme-like" and was not matched above (e.g. "1http:x"): reject
  const firstDelim = cleaned.search(/[/?#]/);
  const head = firstDelim === -1 ? cleaned : cleaned.slice(0, firstDelim);
  if (head.includes(":")) return null;

  if (cleaned.startsWith("#")) return { href: encodeSpaces(cleaned), kind: "fragment", external: false };

  if (opts.absolute && opts.baseUrl) {
    try {
      const resolved = new URL(encodeSpaces(cleaned), opts.baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        return { href: resolved.href, kind: "absolute", external: false };
      }
      return null;
    } catch {
      return null;
    }
  }
  return { href: encodeSpaces(cleaned), kind: "relative", external: false };
}

/** Turn a possibly relative safe URL into an absolute one when a baseUrl exists. */
export function absolutize(href: string, baseUrl?: string): string {
  if (!baseUrl || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/* ------------------------------ embeds ------------------------------ */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,32}$/;
const FIGMA_ID = /^[A-Za-z0-9_-]{6,64}$/;
const TWEET_ID = /^\d{1,25}$/;

export const isValidYouTubeId = (id: unknown): id is string => typeof id === "string" && YOUTUBE_ID.test(id);
export const isValidFigmaId = (id: unknown): id is string => typeof id === "string" && FIGMA_ID.test(id);
export const isValidTweetId = (id: unknown): id is string => typeof id === "string" && TWEET_ID.test(id);

/** iframe `src` URLs (always built from validated ids; verified against the host allowlist). */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}
export function figmaEmbedUrl(id: string): string {
  return `https://www.figma.com/embed?embed_host=bcf&url=${encodeURIComponent(`https://www.figma.com/file/${id}`)}`;
}
export function tweetEmbedUrl(id: string): string {
  return `https://platform.twitter.com/embed/Tweet.html?dnt=true&id=${id}`;
}

/** Plain link targets (email/rss/`embeds: "link"`). */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}
export function youtubeThumbnailUrl(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}
export function figmaFileUrl(id: string): string {
  return `https://www.figma.com/file/${id}`;
}
export function tweetUrl(id: string): string {
  return `https://x.com/i/web/status/${id}`;
}

/** True when `url` is https and its host is on the iframe allowlist. */
export function isAllowedEmbedUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const hosts: readonly string[] = [...EMBED_HOSTS.youtube, ...EMBED_HOSTS.figma, ...EMBED_HOSTS.twitter];
  return hosts.includes(u.hostname.toLowerCase());
}

/** Schemes that are actively dangerous (as opposed to merely not allowlisted). */
export function isDangerousScheme(url: unknown): boolean {
  if (typeof url !== "string") return false;
  // eslint-disable-next-line no-control-regex
  const cleaned = url.replace(/[\u0000-\u0020\u007F-\u009F\u200B-\u200F\uFEFF]/g, "");
  const m = SCHEME.exec(cleaned);
  return !!m && ["javascript", "vbscript", "data", "file", "blob", "livescript"].includes(m[1]!.toLowerCase());
}
