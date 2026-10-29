import { sql, type Database } from "@blog/db";
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";

/**
 * express-rate-limit store backed by the `rate_limit` table: fixed windows shared by every serverless instance.
 * One atomic upsert per hit (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), so concurrent instances never lose a count and
 * nothing depends on session state (a transaction-mode pooler such as Supavisor is fine). The database clock decides when a window ends.
 *
 * Use it for the abuse-sensitive limits only (sign-in, comments, newsletter): it costs one query per request.
 */
export class PgRateLimitStore implements Store {
  /** Keys are not process-local: express-rate-limit must not assume it can reset them from memory. */
  readonly localKeys = false;
  private windowMs = 60_000;

  constructor(
    private readonly db: Pick<Database, "execute">,
    /** Namespaces the limiter inside the shared table (`auth:`, `comment:` …). */
    private readonly keyPrefix: string,
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private k(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const ms = this.windowMs;
    const res = await this.db.execute<{ hits: number; reset_at: Date }>(sql`
      insert into rate_limit as r (key, hits, reset_at)
      values (${this.k(key)}, 1, now() + (${ms}::double precision) * interval '1 millisecond')
      on conflict (key) do update set
        hits = case when r.reset_at <= now() then 1 else r.hits + 1 end,
        reset_at = case when r.reset_at <= now() then now() + (${ms}::double precision) * interval '1 millisecond' else r.reset_at end
      returning hits, reset_at`);
    const row = res.rows[0]!;
    return { totalHits: Number(row.hits), resetTime: new Date(row.reset_at) };
  }

  async decrement(key: string): Promise<void> {
    await this.db.execute(sql`update rate_limit set hits = greatest(hits - 1, 0) where key = ${this.k(key)}`);
  }

  async resetKey(key: string): Promise<void> {
    await this.db.execute(sql`delete from rate_limit where key = ${this.k(key)}`);
  }
}

/** Housekeeping for the daily cron: rows whose window ended more than an hour ago are never read again. */
export async function purgeExpiredRateLimits(db: Pick<Database, "execute">): Promise<number> {
  const res = await db.execute(sql`delete from rate_limit where reset_at < now() - interval '1 hour'`);
  return res.rowCount ?? 0;
}
