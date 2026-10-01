import type { ErrorCode } from "@blog/shared";

/** Throw from anywhere (handlers are async-safe in Express 5) to produce the SPEC error envelope. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: ErrorCode, message: string, options?: { details?: unknown; headers?: Record<string, string>; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.headers = options?.headers;
  }
}

export const badRequest = (message = "Invalid request", details?: unknown) => new HttpError(400, "validation_error", message, { details });
export const unauthorized = (message = "Authentication required") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);
export const conflict = (message = "Conflict", details?: unknown) => new HttpError(409, "conflict", message, { details });
export const tooManyRequests = (message = "Too many requests, please try again later", retryAfterSeconds?: number) =>
  new HttpError(429, "rate_limited", message, retryAfterSeconds ? { headers: { "retry-after": String(retryAfterSeconds) } } : undefined);
export const internal = (message = "Internal server error") => new HttpError(500, "internal", message);
