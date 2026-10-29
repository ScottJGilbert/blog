import tls from "node:tls";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, DEFAULT_TEST_DATABASE_URL } from "../src/client";

/**
 * Real TLS handshakes against the test server's own self-signed certificate (Debian ships one): proves the same failure
 * Supabase gives with Node's default trust store ("self-signed certificate in certificate chain") and each way out of it.
 * Skipped when the server has no TLS.
 */
const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
url.searchParams.set("sslmode", "require");
let cert: string | undefined;

beforeAll(async () => {
  const h = createDb(url.toString().replace("sslmode=require", "sslmode=disable"));
  try {
    const on = (await h.db.execute<{ ssl: string }>(sql`show ssl`)).rows[0]?.ssl === "on";
    if (on) cert = (await h.db.execute<{ pem: string }>(sql`select pg_read_file(current_setting('ssl_cert_file')) as pem`)).rows[0]?.pem;
  } catch {
    /* not superuser / no TLS: tests below skip */
  } finally {
    await h.close();
  }
});

async function ping(env: Record<string, string | undefined>): Promise<unknown> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const h = createDb(url.toString());
  try {
    return (await h.db.execute<{ one: number }>(sql`select 1 as one`)).rows[0]?.one;
  } finally {
    await h.close();
    process.env = saved;
  }
}

describe("TLS against a server with a self-signed certificate", () => {
  it("strict verification fails (non-Supabase host: never silently downgraded)", async () => {
    if (!cert) return;
    const err = (await ping({ DATABASE_SSL: undefined, DATABASE_SSL_CA: undefined }).catch((e: Error) => e)) as Error & { cause?: Error };
    expect((err.cause ?? err).message).toMatch(/self[- ]signed|unable to verify|certificate/i);
  });

  it("DATABASE_SSL=no-verify connects", async () => {
    if (!cert) return;
    expect(await ping({ DATABASE_SSL: "no-verify" })).toBe(1);
  });

  it("DATABASE_SSL_CA (PEM and base64) verifies the chain; verify-ca tolerates a certificate issued for another hostname", async () => {
    if (!cert) return;
    const b64 = Buffer.from(cert).toString("base64");
    for (const ca of [cert, b64]) expect(await ping({ DATABASE_SSL: "verify-ca", DATABASE_SSL_CA: ca })).toBe(1);
    // a wrong CA must be rejected even with verify-ca
    const err = (await ping({ DATABASE_SSL: "verify-ca", DATABASE_SSL_CA: tls.rootCertificates[0] }).catch((e: Error) => e)) as Error & { cause?: Error };
    expect((err.cause ?? err).message).toMatch(/self[- ]signed|unable to verify|certificate/i);
  });
});
