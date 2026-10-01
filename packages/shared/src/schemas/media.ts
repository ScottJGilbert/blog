import { z } from "zod";
import { IsoDateSchema, PaginationQuerySchema, UuidSchema } from "./common";

export const MediaSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  url: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().min(0),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  alt: z.string().nullable(),
  uploadedBy: z.string().nullable(),
  createdAt: IsoDateSchema,
});
export const ListMediaQuerySchema = PaginationQuerySchema;
export const UpdateMediaInputSchema = z.object({ alt: z.string().trim().max(300).nullable() });
/** multipart/form-data fields besides the `file` part */
export const UploadMediaFieldsSchema = z.object({ alt: z.string().trim().max(300).optional() });

export type Media = z.infer<typeof MediaSchema>;
export type ListMediaQuery = z.output<typeof ListMediaQuerySchema>;
export type ListMediaQueryInput = z.input<typeof ListMediaQuerySchema>;
export type UpdateMediaInput = z.infer<typeof UpdateMediaInputSchema>;
