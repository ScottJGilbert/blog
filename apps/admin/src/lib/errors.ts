import { isApiError } from "@blog/shared/client";

export interface FieldErrors {
  [field: string]: string;
}

interface Issue {
  path?: unknown;
  message?: unknown;
}

/** Human-readable message for any thrown value (never leaks stack traces). */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isApiError(err)) {
    switch (err.code) {
      case "network_error":
        return "Could not reach the server. Check your connection and try again.";
      case "timeout":
        return "The request timed out. Please try again.";
      case "bad_response":
        return "The server sent an unexpected response.";
      default:
    }
    if (err.status === 413) {
      return "The request is too large for the server. Remove or compress large embedded images, or upload them via the media library.";
    }
    if (err.status === 429) return "Too many requests. Wait a moment and try again.";
    if (err.status === 401) return "Your session has expired. Please sign in again.";
    if (err.status === 403 && !err.message) return "You do not have permission to do that.";
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * Maps a zod-style `details` array of a 400/422 `validation_error` to `{ field: message }`.
 * Field = first path segment (`tags.2` -> `tags`), so inline errors can sit next to the control.
 */
export function fieldErrorsFromApi(err: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (!isApiError(err)) return out;
  const details = err.details;
  const issues: Issue[] = Array.isArray(details)
    ? (details as Issue[])
    : details && typeof details === "object" && Array.isArray((details as { issues?: unknown }).issues)
      ? ((details as { issues: Issue[] }).issues)
      : [];
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? issue.path : [];
    const key = path.length ? String(path[0]) : "_form";
    if (typeof issue.message === "string" && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Same shape from a zod error (client-side validation). */
export function fieldErrorsFromZod(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function isUnauthorized(err: unknown): boolean {
  return isApiError(err) && err.status === 401;
}
