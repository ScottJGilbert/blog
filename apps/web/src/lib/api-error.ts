/**
 * Browser-safe shape check for errors thrown by the shared API client. The client itself (and zod, which it
 * bundles) is only loaded on demand (see browser-api.ts) so public pages ship none of it; this duck-typed guard
 * lets UI code inspect failures without importing it.
 */
export interface ClientApiError {
  name: "ApiError";
  status: number;
  code: string;
  message: string;
}

export function isApiError(err: unknown): err is ClientApiError {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "ApiError" && "status" in err;
}

export const isValidationError = (err: unknown) => isApiError(err) && err.code === "validation_error";
export const hasStatus = (err: unknown, status: number) => isApiError(err) && err.status === status;
