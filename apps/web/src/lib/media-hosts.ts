/**
 * Hosts cover images / content images may be served from through next/image. Shared by next.config.ts (remotePatterns)
 * and the runtime helper below. Relative URLs (`/api/media/files/...`, the local storage driver) are always allowed.
 *   NEXT_PUBLIC_MEDIA_HOST   comma-separated extra hostnames (e.g. a CDN in front of the blob store)
 */
export const MEDIA_HOSTS: string[] = [
  "*.public.blob.vercel-storage.com", // Vercel Blob storage driver
  "picsum.photos", // demo covers used by the seed data
  ...(process.env.NEXT_PUBLIC_MEDIA_HOST ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
];

function hostAllowed(hostname: string): boolean {
  return MEDIA_HOSTS.some((pattern) =>
    pattern.startsWith("*.") ? hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1 : hostname === pattern,
  );
}

/** Props for a next/image of `url`: unoptimized (but still rendered) when the host isn't allow-listed. */
export function imageSource(url: string): { src: string; unoptimized: boolean } {
  // Site-relative path. `/\\host` is read by browsers as `//host` (protocol-relative), so it is not a path.
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return { src: url, unoptimized: url.includes("?") };
  try {
    const u = new URL(url);
    // Only http(s) images: `javascript:`, `data:` etc. never reach an <img>, og:image or JSON-LD.
    if (u.protocol !== "https:" && u.protocol !== "http:") return { src: "", unoptimized: true };
    if (hostAllowed(u.hostname)) return { src: url, unoptimized: false };
    return { src: url, unoptimized: true };
  } catch {
    return { src: "", unoptimized: true };
  }
}
