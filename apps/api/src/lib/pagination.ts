import { type PaginationMeta, PaginationQuerySchema, paginationMeta, type PaginationQuery } from "@blog/shared";
import type { Request, Response } from "express";

export type { PaginationQuery, PaginationMeta };

/** `?page=&pageSize=` with SPEC defaults/limits (page ≥ 1, pageSize 1..50, default 10). Throws → 400. */
export function parsePagination(query: unknown): PaginationQuery {
  return PaginationQuerySchema.parse(query);
}

/** Convenience for handlers: `const { page, pageSize, offset } = pageParams(req)`. */
export function pageParams(req: Request): PaginationQuery & { offset: number; limit: number } {
  const p = parsePagination(req.query);
  return { ...p, offset: (p.page - 1) * p.pageSize, limit: p.pageSize };
}

export function offsetOf(p: { page: number; pageSize: number }): number {
  return (p.page - 1) * p.pageSize;
}

/** Send `{ data, meta }`. */
export function paginated<T>(res: Response, input: { data: T[]; total: number; page: number; pageSize: number }): Response {
  const meta: PaginationMeta = paginationMeta(input.total, input.page, input.pageSize);
  return res.json({ data: input.data, meta });
}

/** Send `{ data }`. */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ data });
}
