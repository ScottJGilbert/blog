import type { ErrorEnvelope } from "@blog/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../errors";
import type { Logger } from "../logger";

function envelope(code: ErrorEnvelope["error"]["code"], message: string, details?: unknown): ErrorEnvelope {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

/** Anything the body parser (or similar) throws with a `status` + `type`. */
function asHttpish(err: unknown): { status: number; type?: string } | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: unknown; statusCode?: unknown; type?: unknown };
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : undefined;
  if (!status || status < 400 || status > 599) return null;
  return { status, type: typeof e.type === "string" ? e.type : undefined };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(envelope("not_found", `Route not found: ${req.method} ${req.path}`));
};

/** Central error handler → SPEC error envelope. Unknown errors never leak their message. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const reqId = (req as { id?: unknown }).id;

    if (err instanceof HttpError) {
      if (err.headers) res.set(err.headers);
      return void res.status(err.status).json(envelope(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      return void res.status(400).json(envelope("validation_error", "Invalid request", err.issues));
    }
    const http = asHttpish(err);
    if (http) {
      if (http.status === 413) return void res.status(413).json(envelope("validation_error", "Request body too large"));
      if (http.status === 400 && (http.type === "entity.parse.failed" || http.type === "encoding.unsupported")) {
        return void res.status(400).json(envelope("validation_error", "Malformed request body"));
      }
      if (http.status === 415) return void res.status(415).json(envelope("validation_error", "Unsupported media type"));
      if (http.status === 429) return void res.status(429).json(envelope("rate_limited", "Too many requests, please try again later"));
      if (http.status < 500) {
        const code = http.status === 401 ? "unauthorized" : http.status === 403 ? "forbidden" : http.status === 404 ? "not_found" : http.status === 409 ? "conflict" : "validation_error";
        return void res.status(http.status).json(envelope(code, "Request could not be processed"));
      }
    }

    logger.error({ err, reqId, method: req.method, path: req.path }, "unhandled error");
    res.status(500).json(envelope("internal", "Internal server error"));
  };
}
