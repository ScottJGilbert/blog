/** Deterministic date formatting (no Intl/locale dependence): `May 6, 2024` or `May 6, 2024 07:08 UTC`. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseIsoInstant(value: string): Date | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/** `null` when `value` is not a parseable date. */
export function formatDateTime(value: string): string {
  const d = parseIsoInstant(value);
  if (!d) return "";
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (h === 0 && m === 0) return date;
  return `${date} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} UTC`;
}

export function toIsoString(value: string): string | null {
  const d = parseIsoInstant(value);
  return d ? d.toISOString() : null;
}
