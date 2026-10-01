import { z } from "zod";
import { ApiKeyScopeSchema, IsoDateSchema, PaginationQuerySchema, SubscriberStatusSchema, UrlOrPathSchema, UserRoleSchema, UuidSchema } from "./common";

// ----- me ------------------------------------------------------------------------------------------------------------
export const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: UserRoleSchema,
  emailVerified: z.boolean(),
  subscription: z.object({ status: SubscriberStatusSchema }).nullable(),
});
export const UpdateMeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    image: UrlOrPathSchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.image !== undefined, "provide name and/or image");

// ----- admin users ---------------------------------------------------------------------------------------------------
export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: UserRoleSchema,
  emailVerified: z.boolean(),
  banned: z.boolean(),
  banReason: z.string().nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  role: UserRoleSchema.optional(),
  banned: z.stringbool().optional(),
});
export const UpdateUserInputSchema = z.object({ role: UserRoleSchema.optional() });
export const BanUserInputSchema = z.object({ reason: z.string().trim().min(1).max(500) });

// ----- api keys ------------------------------------------------------------------------------------------------------
export const ApiKeySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  /** first 8 characters of the key */
  prefix: z.string(),
  scopes: z.array(ApiKeyScopeSchema),
  lastUsedAt: IsoDateSchema.nullable(),
  revokedAt: IsoDateSchema.nullable(),
  createdBy: z.string().nullable(),
  createdAt: IsoDateSchema,
});
export const CreateApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(ApiKeyScopeSchema).max(ApiKeyScopeSchema.options.length).default([]),
});
/** Returned once on creation; `key` is `blg_<random>` and is never retrievable again. */
export const ApiKeyCreatedSchema = ApiKeySchema.extend({ key: z.string() });

export type Me = z.infer<typeof MeSchema>;
export type UpdateMeInput = z.infer<typeof UpdateMeInputSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type ListUsersQuery = z.output<typeof ListUsersQuerySchema>;
export type ListUsersQueryInput = z.input<typeof ListUsersQuerySchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;
export type BanUserInput = z.infer<typeof BanUserInputSchema>;
export type ApiKey = z.infer<typeof ApiKeySchema>;
export type CreateApiKeyInput = z.output<typeof CreateApiKeyInputSchema>;
export type CreateApiKeyInputInput = z.input<typeof CreateApiKeyInputSchema>;
export type ApiKeyCreated = z.infer<typeof ApiKeyCreatedSchema>;
