import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, getDb, getDbHandle, type DbOrTx } from "../src/client";
import { user } from "../src/schema/index";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await closeDb();
  await t.close();
});

describe("createDb", () => {
  it("connects, queries, and close() is idempotent", async () => {
    const h = createDb(t.url, { max: 2 });
    const r = await h.db.execute(sql`select 1 as one`);
    expect(r.rows[0]).toEqual({ one: 1 });
    expect(h.pool.options.max).toBe(2);
    await h.close();
    await h.close();
  });

  it("enables TLS for sslmode=require / neon hosts, not for localhost", async () => {
    const neon = createDb("postgres://u:p@ep-cool-123-pooler.eu-west-2.aws.neon.tech/db?sslmode=require");
    const opts = neon.pool.options as { ssl?: unknown; connectionString?: string };
    expect(opts.ssl).toBeTruthy();
    expect(opts.connectionString).not.toMatch(/sslmode/);
    await neon.close();
    const bare = createDb("postgres://u:p@ep-x.neon.tech/db");
    expect((bare.pool.options as { ssl?: unknown }).ssl).toBeTruthy();
    await bare.close();
    const local = createDb("postgres://blog:blog@localhost:5432/blog");
    expect((local.pool.options as { ssl?: unknown }).ssl).toBeFalsy();
    await local.close();
  });

  it("getDb() is a per-URL singleton", async () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = t.url;
    try {
      const a = getDb();
      expect(getDb()).toBe(a);
      expect(getDbHandle().pool).toBe(a.$client);
      await a.execute(sql`select 1`);
    } finally {
      await closeDb();
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it("DbOrTx accepts both the database and a transaction", async () => {
    const count = async (db: DbOrTx) => (await db.select({ id: user.id }).from(user)).length;
    await t.db.transaction(async (tx) => {
      await tx.insert(user).values({ id: "tx-user", name: "Tx", email: "tx@example.com" });
      expect(await count(tx)).toBe(1);
      tx.rollback();
    }).catch(() => undefined);
    expect(await count(t.db)).toBe(0);
    expect(await t.db.select().from(user).where(eq(user.id, "tx-user"))).toHaveLength(0);
  });
});
