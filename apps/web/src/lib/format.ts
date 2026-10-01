const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });
const shortDateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** UTC formatting so server and client always agree (no hydration mismatch). */
export const formatDate = (iso: string | Date) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string | Date) => shortDateTime.format(new Date(iso)) + " UTC";

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(iso);
}
