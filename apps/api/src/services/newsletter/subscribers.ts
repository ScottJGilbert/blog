import { and, asc, count, desc, eq, gt, ilike, isNotNull, subscriber, type SQL } from "@blog/db";
import type { ListSubscribersQuery, Subscriber, SubscriberSyncResult } from "@blog/shared";
import type { Deps } from "../../deps";
import { notFound } from "../../errors";
import { audit } from "../../lib/audit";
import { iso, likePattern } from "../admin/common";

type Row = typeof subscriber.$inferSelect;
type Actor = { id: string };

export function toSubscriber(r: Row): Subscriber {
  return {
    id: r.id,
    email: r.email,
    userId: r.userId,
    status: r.status,
    source: r.source,
    listmonkSubscriberId: r.listmonkSubscriberId,
    createdAt: r.createdAt.toISOString(),
    confirmedAt: iso(r.confirmedAt),
    unsubscribedAt: iso(r.unsubscribedAt),
  };
}

const BATCH = 200;
const CONCURRENCY = 5;

/** Run `fn` over `items` with a small concurrency cap; never rejects (the callback reports success itself). */
async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

export function createSubscribersService(deps: Deps) {
  const { db } = deps;
  const provider = () => deps.newsletter;
  const isNoop = () => (provider().kind ?? "noop") === "noop";

  return {
    async list(q: ListSubscribersQuery): Promise<{ items: Subscriber[]; total: number }> {
      const conds: SQL[] = [];
      if (q.status) conds.push(eq(subscriber.status, q.status));
      if (q.q) conds.push(ilike(subscriber.email, likePattern(q.q.toLowerCase())));
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [totals]] = await Promise.all([
        db
          .select()
          .from(subscriber)
          .where(where)
          .orderBy(desc(subscriber.createdAt), desc(subscriber.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db.select({ n: count() }).from(subscriber).where(where),
      ]);
      return { items: rows.map(toSubscriber), total: totals?.n ?? 0 };
    },

    /** Delete locally and (best effort) erase from the provider. */
    async remove(actor: Actor, id: string): Promise<void> {
      const [row] = await db.select().from(subscriber).where(eq(subscriber.id, id)).limit(1);
      if (!row) throw notFound("Subscriber not found");
      let providerError: string | undefined;
      if (!isNoop() && (row.listmonkSubscriberId !== null || row.status !== "pending")) {
        try {
          const p = provider();
          const ref = row.listmonkSubscriberId !== null ? String(row.listmonkSubscriberId) : row.email;
          if (p.deleteSubscriber) await p.deleteSubscriber(ref);
          else await p.removeSubscriber(ref);
        } catch (err) {
          providerError = err instanceof Error ? err.message : String(err);
          deps.logger.warn({ subscriberId: id, err: providerError }, "could not remove subscriber from the newsletter provider");
        }
      }
      await db.transaction(async (tx) => {
        await tx.delete(subscriber).where(eq(subscriber.id, id));
        await audit(tx, actor, {
          action: "subscriber.delete",
          targetType: "subscriber",
          targetId: id,
          meta: { status: row.status, ...(providerError ? { providerError } : {}) },
        });
      });
    },

    /**
     * Re-sync with the provider (idempotent, batched, safe to repeat):
     *  - every `confirmed` subscriber is upserted into the list (stores the provider id),
     *  - every `unsubscribed` subscriber that is still known to the provider is blocklisted (then the stored id is cleared,
     *    so the next run skips it).
     * `synced` counts successful operations, `failed` the failed ones.
     */
    async sync(actor: Actor): Promise<SubscriberSyncResult> {
      if (isNoop()) return { providerConfigured: false, synced: 0, failed: 0 };
      const p = provider();
      let synced = 0;
      let failed = 0;

      const batches = async (where: SQL, handle: (row: Row) => Promise<void>) => {
        let cursor: string | null = null;
        for (;;) {
          const rows: Row[] = await db
            .select()
            .from(subscriber)
            .where(cursor ? and(where, gt(subscriber.id, cursor)) : where)
            .orderBy(asc(subscriber.id))
            .limit(BATCH);
          if (rows.length === 0) break;
          await pool(rows, handle);
          cursor = rows[rows.length - 1]!.id;
          if (rows.length < BATCH) break;
        }
      };

      await batches(eq(subscriber.status, "confirmed"), async (row) => {
        try {
          const { externalId } = await p.upsertSubscriber(row.email);
          const n = Number(externalId);
          if (Number.isInteger(n) && n !== row.listmonkSubscriberId) {
            await db.update(subscriber).set({ listmonkSubscriberId: n }).where(eq(subscriber.id, row.id));
          }
          synced++;
        } catch (err) {
          failed++;
          deps.logger.warn({ subscriberId: row.id, err: err instanceof Error ? err.message : String(err) }, "subscriber sync: upsert failed");
        }
      });

      await batches(and(eq(subscriber.status, "unsubscribed"), isNotNull(subscriber.listmonkSubscriberId))!, async (row) => {
        try {
          await p.removeSubscriber(String(row.listmonkSubscriberId));
          await db.update(subscriber).set({ listmonkSubscriberId: null }).where(eq(subscriber.id, row.id));
          synced++;
        } catch (err) {
          failed++;
          deps.logger.warn({ subscriberId: row.id, err: err instanceof Error ? err.message : String(err) }, "subscriber sync: removal failed");
        }
      });

      await audit(db, actor, { action: "subscriber.sync", targetType: "subscriber", meta: { synced, failed } });
      return { providerConfigured: true, synced, failed };
    },
  };
}

export type SubscribersService = ReturnType<typeof createSubscribersService>;
