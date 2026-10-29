import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import {
  cleanConnectionString,
  createDb,
  describeUrl,
  isDirectSupabaseHost,
  isPooledUrl,
  migrationDatabaseUrl,
  migrationDatabaseUrls,
  parseCa,
  redactUrl,
  resolveDatabaseUrl,
  resolveSsl,
  resolveUnpooledUrl,
  scrubSecrets,
} from "../src/client";
import { isUnreachableError, migrateFirstReachable } from "../src/migrate";

const POOLED = "postgres://postgres.abcdefghij:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x";
const SESSION = "postgres://postgres.abcdefghij:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require";
const DIRECT = "postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres";
const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";

describe("env aliasing", () => {
  it("DATABASE_URL falls back to POSTGRES_URL, DATABASE_URL_UNPOOLED to POSTGRES_URL_NON_POOLING", () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: POOLED })).toBe(POOLED);
    // the Vercel integration may prefix every variable (SUPABASE_STORAGE_POSTGRES_URL)
    expect(resolveDatabaseUrl({ SUPABASE_STORAGE_POSTGRES_URL: POOLED, SUPABASE_STORAGE_POSTGRES_PRISMA_URL: "x" })).toBe(POOLED);
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a/b", POSTGRES_URL: POOLED })).toBe("postgres://a/b");
    expect(resolveDatabaseUrl({ DATABASE_URL: "  ", POSTGRES_URL: POOLED })).toBe(POOLED);
    expect(resolveDatabaseUrl({})).toBeUndefined();
    expect(resolveUnpooledUrl({ POSTGRES_URL_NON_POOLING: DIRECT })).toBe(DIRECT);
    expect(resolveUnpooledUrl({ DATABASE_URL_UNPOOLED: SESSION, POSTGRES_URL_NON_POOLING: DIRECT })).toBe(SESSION);
  });

  it("migrations prefer the direct URL, then the pooled one (as fallback), then the local default", () => {
    const env = { POSTGRES_URL: POOLED, POSTGRES_URL_NON_POOLING: DIRECT };
    expect(migrationDatabaseUrls(env)).toEqual([DIRECT, POOLED]);
    expect(migrationDatabaseUrl(env)).toBe(DIRECT);
    expect(migrationDatabaseUrls({ POSTGRES_URL: POOLED })).toEqual([POOLED]);
    expect(migrationDatabaseUrls({ DATABASE_URL: POOLED, POSTGRES_URL: POOLED })).toEqual([POOLED]);
    expect(migrationDatabaseUrls({})).toEqual(["postgres://blog:blog@localhost:5432/blog"]);
  });

  it("detects Supabase transaction poolers (6543) but not the session pooler or the direct host", () => {
    expect(isPooledUrl(POOLED)).toBe(true);
    expect(isPooledUrl(SESSION)).toBe(false);
    expect(isPooledUrl(DIRECT)).toBe(false);
    expect(isPooledUrl("postgres://u:p@localhost:6543/db")).toBe(false);
    expect(isDirectSupabaseHost("db.abcdefghij.supabase.co")).toBe(true);
    expect(isDirectSupabaseHost("aws-0-eu-west-2.pooler.supabase.com")).toBe(false);
  });
});

describe("TLS", () => {
  const quiet = () => undefined;

  it("Supabase host without a CA: TLS, not verified, with a warning", () => {
    const warn = vi.fn();
    expect(resolveSsl(POOLED, {}, warn)).toEqual({ rejectUnauthorized: false });
    expect(resolveSsl(DIRECT, {}, warn)).toEqual({ rejectUnauthorized: false }); // no sslmode in the URL at all
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatch(/NOT verified/);
  });

  it("DATABASE_SSL_CA (PEM or base64 PEM) turns on full verification", () => {
    const warn = vi.fn();
    for (const ca of [PEM, Buffer.from(PEM).toString("base64"), PEM.replace(/\n/g, "\\n")]) {
      expect(resolveSsl(POOLED, { DATABASE_SSL_CA: ca }, warn)).toEqual({ ca: PEM.trim(), rejectUnauthorized: true });
    }
    expect(warn).not.toHaveBeenCalled();
    expect(() => parseCa("not a certificate")).toThrow(/neither a PEM/);
    expect(() => parseCa("not a certificate")).not.toThrow(/not a certificate/); // never echoes the value
  });

  it("verify-ca keeps chain verification but skips the hostname check (pooler certificate names are unverified)", () => {
    const viaEnv = resolveSsl(POOLED, { DATABASE_SSL_CA: PEM, DATABASE_SSL: "verify-ca" }, quiet) as { checkServerIdentity?: () => unknown; rejectUnauthorized: boolean };
    expect(viaEnv.rejectUnauthorized).toBe(true);
    expect(viaEnv.checkServerIdentity?.()).toBeUndefined();
    const strict = resolveSsl(POOLED, { DATABASE_SSL_CA: PEM }, quiet) as { checkServerIdentity?: unknown };
    expect(strict.checkServerIdentity).toBeUndefined();
  });

  it("DATABASE_SSL=no-verify is the explicit escape hatch, for any host", () => {
    expect(resolveSsl("postgres://u:p@db.example.org/db?sslmode=require", { DATABASE_SSL: "no-verify" }, quiet)).toEqual({ rejectUnauthorized: false });
    expect(resolveSsl(POOLED, { DATABASE_SSL: "no-verify", DATABASE_SSL_CA: PEM }, quiet)).toEqual({ rejectUnauthorized: false });
  });

  it("never silently disables verification for other hosts, and honours sslmode=disable / local URLs", () => {
    expect(resolveSsl("postgres://u:p@db.example.org/db?sslmode=require", {}, quiet)).toEqual({ rejectUnauthorized: true });
    expect(resolveSsl("postgres://u:p@db.example.org/db?ssl=true", {}, quiet)).toEqual({ rejectUnauthorized: true });
    expect(resolveSsl("postgres://u:p@db.example.org/db", {}, quiet)).toBe(false);
    expect(resolveSsl("postgres://blog:blog@localhost:5432/blog?sslmode=disable", {}, quiet)).toBe(false);
    expect(resolveSsl(POOLED.replace("sslmode=require", "sslmode=disable"), {}, quiet)).toBe(false);
    expect(resolveSsl("postgres://blog:blog@localhost:5432/blog", {}, quiet)).toBe(false);
  });
});

describe("connection string", () => {
  it("strips supa / pgbouncer / connection_limit and the consumed TLS flags, keeps everything else", () => {
    const cleaned = cleanConnectionString("postgres://u:p@h:6543/db?sslmode=require&supa=base-pooler.x&pgbouncer=true&connection_limit=1&application_name=x&connect_timeout=5");
    expect(new URL(cleaned).searchParams.toString()).toBe("application_name=x&connect_timeout=5");
    expect(cleanConnectionString(POOLED)).toBe("postgres://postgres.abcdefghij:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres");
    expect(cleanConnectionString("not a url")).toBe("not a url");
  });

  it("createDb hands pg a clean string and a pooler-safe config", async () => {
    const h = createDb(POOLED);
    const o = h.pool.options as { connectionString: string; ssl: unknown };
    expect(o.connectionString).not.toMatch(/supa=|sslmode|pgbouncer/);
    expect(o.ssl).toEqual({ rejectUnauthorized: false });
    expect(h.pool.options).not.toHaveProperty("application_name");
    await h.close();
    const session = createDb(SESSION);
    expect(session.pool.options).not.toHaveProperty("application_name"); // pooler hosts: no optional startup parameters
    await session.close();
    const direct = createDb(DIRECT);
    expect(direct.pool.options).toHaveProperty("application_name", "blog");
    await direct.close();
  });

  it("the postgres.<ref> username and percent-encoded @ # / : % in the password round-trip through pg", () => {
    const password = "p@ss#w/rd:1%2 &=?";
    const url = `postgres://postgres.abcdefghij:${encodeURIComponent(password)}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x`;
    const client = new pg.Client({ connectionString: cleanConnectionString(url) });
    expect(client.user).toBe("postgres.abcdefghij");
    expect(client.password).toBe(password);
    expect(client.host).toBe("aws-0-eu-west-2.pooler.supabase.com");
    expect(client.port).toBe(6543);
    expect(client.database).toBe("postgres");
    // a raw @ in the password is also understood (the last @ separates the host)
    const raw = new pg.Client({ connectionString: cleanConnectionString("postgres://postgres.abc:pa@ss@host.example.org:6543/postgres?supa=x") });
    expect(raw.password).toBe("pa@ss");
    expect(raw.host).toBe("host.example.org");
  });

  it("never prints the password: redactUrl / describeUrl / scrubSecrets", () => {
    for (const pw of ["S3cr3t", "pa@ss", "p%40ss%23"]) {
      const url = `postgres://postgres.abc:${pw}@aws-0.pooler.supabase.com:6543/postgres?sslmode=require`;
      expect(redactUrl(url)).toBe("postgres://***@aws-0.pooler.supabase.com:6543/postgres?sslmode=require");
      expect(describeUrl(url)).toBe("aws-0.pooler.supabase.com:6543/postgres");
      expect(scrubSecrets(`connect failed: ${url} (password ${pw})`, url)).not.toContain(pw);
    }
    expect(scrubSecrets("password p@ss#1 rejected", "postgres://u:p%40ss%231@h/db")).toBe("password *** rejected");
  });
});

describe("IPv6-only direct host fallback", () => {
  const codes = (code: string) => Object.assign(new Error(`connect ${code}`), { code });

  it("recognises unreachable-host errors, including AggregateError and cause chains", () => {
    for (const c of ["ENETUNREACH", "EADDRNOTAVAIL", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"]) expect(isUnreachableError(codes(c))).toBe(true);
    expect(isUnreachableError(Object.assign(new AggregateError([codes("ENETUNREACH")]), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isUnreachableError(new Error("x", { cause: codes("ENOTFOUND") }))).toBe(true);
    expect(isUnreachableError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isUnreachableError(codes("ECONNREFUSED"))).toBe(false);
    expect(isUnreachableError(new Error("password authentication failed for user"))).toBe(false);
  });

  it("falls back from db.<ref>.supabase.co to the pooler, saying why", async () => {
    const tried: string[] = [];
    const logs: string[] = [];
    const used = await migrateFirstReachable([DIRECT, POOLED], {
      log: (m) => logs.push(m),
      run: async (url) => {
        tried.push(url);
        if (url === DIRECT) throw codes("ENETUNREACH");
      },
    });
    expect(used).toBe(POOLED);
    expect(tried).toEqual([DIRECT, POOLED]);
    expect(logs.join("\n")).toMatch(/db\.abcdefghij\.supabase\.co is unreachable.*ENETUNREACH.*IPv6-only/);
    expect(logs.join("\n")).not.toContain("pw@");
  });

  it("does not fall back for other failures, other hosts, or when there is nothing to fall back to", async () => {
    const run = (err: Error) => async () => {
      throw err;
    };
    await expect(migrateFirstReachable([DIRECT, POOLED], { log: () => undefined, run: run(new Error("password authentication failed")) })).rejects.toThrow(/password authentication/);
    await expect(migrateFirstReachable([SESSION, POOLED], { log: () => undefined, run: run(codes("ENETUNREACH")) })).rejects.toThrow(/ENETUNREACH/);
    await expect(migrateFirstReachable([DIRECT], { log: () => undefined, run: run(codes("ENETUNREACH")) })).rejects.toThrow(/ENETUNREACH/);
  });

  it("scrubs the password from the rethrown error", async () => {
    const url = "postgres://postgres.abc:Sup3rS3cret@aws-0.pooler.supabase.com:6543/postgres";
    const err = await migrateFirstReachable([url], { log: () => undefined, run: async () => { throw new Error(`bad ${url} Sup3rS3cret`); } }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("Sup3rS3cret");
  });
});
