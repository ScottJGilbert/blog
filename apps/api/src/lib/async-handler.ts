import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 5 forwards rejected promises from handlers/middleware to the error handler natively, so this is only a
 * typing convenience (infers `Request`/`Response` for inline functions). Prefer plain `async (req, res) => {}`.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next) as void;
