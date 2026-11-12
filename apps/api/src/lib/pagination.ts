import { paginationMeta } from "@blog/shared";
import type { Response } from "express";

/** Send `{ data, meta }`. */
export function paginated<T>(res: Response, input: { data: T[]; total: number; page: number; pageSize: number }): Response {
  return res.json({ data: input.data, meta: paginationMeta(input.total, input.page, input.pageSize) });
}

/** Send `{ data }`. */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ data });
}
