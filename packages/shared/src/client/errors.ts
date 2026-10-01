import type { ErrorCode } from "../schemas/common";

/** Codes produced client-side (never sent by the server). */
export type ClientErrorCode = "network_error" | "bad_response" | "timeout";

export interface ApiErrorInit {
  status: number;
  code: ErrorCode | ClientErrorCode;
  message: string;
  details?: unknown;
  requestId?: string | null;
  cause?: unknown;
}

/** Thrown by every client method for non-2xx responses and transport failures. */
export class ApiError extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isValidation(): boolean {
    return this.code === "validation_error";
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  toJSON() {
    return { name: this.name, status: this.status, code: this.code, message: this.message, details: this.details };
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "ApiError");
}

export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return "validation_error";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return "internal";
  }
}
