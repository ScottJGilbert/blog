import type { Request } from "express";
import type { z } from "zod";

/**
 * Validate with zod and return the parsed (coerced, defaulted) value.
 * A failure throws a ZodError → the error handler turns it into 400 `validation_error` with `details`.
 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data);
}
export const parseQuery = <S extends z.ZodType>(schema: S, req: Request): z.output<S> => schema.parse(req.query);
export const parseBody = <S extends z.ZodType>(schema: S, req: Request): z.output<S> => schema.parse(req.body ?? {});
export const parseParams = <S extends z.ZodType>(schema: S, req: Request): z.output<S> => schema.parse(req.params);
