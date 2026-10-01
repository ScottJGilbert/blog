import { apiKey, desc, eq, isNull, and } from "@blog/db";
import type { ApiKey, ApiKeyCreated, CreateApiKeyInput } from "@blog/shared";
import type { Deps } from "../../deps";
import { notFound } from "../../errors";
import { audit } from "../../lib/audit";
import { randomToken, sha256Hex } from "../../lib/crypto";
import { iso } from "./common";

type Row = typeof apiKey.$inferSelect;
type Actor = { id: string };

/** `blg_` + 43 URL-safe characters (256 bits of randomness). */
export const API_KEY_FORMAT = /^blg_[A-Za-z0-9_-]{43}$/;
export const API_KEY_PREFIX_LENGTH = 8;

export const generateApiKey = (): string => `blg_${randomToken(32)}`;
export const hashApiKey = (key: string): string => sha256Hex(key);

export function toApiKeyDto(r: Row): ApiKey {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    lastUsedAt: iso(r.lastUsedAt),
    revokedAt: iso(r.revokedAt),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

export function createAdminApiKeysService(deps: Deps) {
  const { db } = deps;
  return {
    async list(): Promise<ApiKey[]> {
      const rows = await db.select().from(apiKey).orderBy(desc(apiKey.createdAt), desc(apiKey.id));
      return rows.map(toApiKeyDto);
    },

    /** The plaintext key is returned exactly once; only its sha256 and an 8-character prefix are stored. */
    async create(actor: Actor, input: CreateApiKeyInput): Promise<ApiKeyCreated> {
      const key = generateApiKey();
      const scopes = [...new Set(input.scopes)];
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(apiKey)
          .values({ name: input.name, prefix: key.slice(0, API_KEY_PREFIX_LENGTH), keyHash: hashApiKey(key), scopes, createdBy: actor.id })
          .returning();
        await audit(tx, actor, { action: "api_key.create", targetType: "api_key", targetId: created!.id, meta: { name: input.name, scopes } });
        return created!;
      });
      return { ...toApiKeyDto(row), key };
    },

    /** Revoke (soft): the row stays for the audit trail. Idempotent. */
    async revoke(actor: Actor, id: string): Promise<void> {
      const [existing] = await db.select().from(apiKey).where(eq(apiKey.id, id)).limit(1);
      if (!existing) throw notFound("API key not found");
      if (existing.revokedAt) return;
      await db.transaction(async (tx) => {
        await tx
          .update(apiKey)
          .set({ revokedAt: deps.now() })
          .where(and(eq(apiKey.id, id), isNull(apiKey.revokedAt)));
        await audit(tx, actor, { action: "api_key.revoke", targetType: "api_key", targetId: id, meta: { name: existing.name, prefix: existing.prefix } });
      });
    },
  };
}

export type AdminApiKeysService = ReturnType<typeof createAdminApiKeysService>;
