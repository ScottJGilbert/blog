import { z } from "zod";

/** Treat `FOO=` (empty) the same as unset. */
const str = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());
const flag = (def: boolean) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => (v === undefined ? def : typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase()))),
  );
const int = (def: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number().int().default(def));
const csv = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v),
  z.array(z.string()).default([]),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: str.default("postgres://blog:blog@localhost:5432/blog"),
  BETTER_AUTH_SECRET: str,
  BETTER_AUTH_URL: str.default("http://localhost:3000"),
  SITE_URL: str.default("http://localhost:3000"),
  SITE_NAME: str.default("Scott Gilbert"),
  API_PORT: int(4000),
  API_BASE_PATH: str.default("/api"),
  API_INTERNAL_URL: str.default("http://localhost:4000"),
  /** extra browser origins allowed for CSRF / Better Auth callbacks (comma list) */
  TRUSTED_ORIGINS: csv,
  /**
   * Number of reverse-proxy hops to trust for client IPs (Express `trust proxy`, hop-count form). With N hops Express reads the
   * Nth entry FROM THE RIGHT of X-Forwarded-For, so a client-supplied prefix can never choose its own rate-limit identity.
   * Vercel: 1 (it overwrites X-Forwarded-For with the real client address). Directly exposed Node server (no proxy at all): 0,
   * otherwise a client can set the header itself and dodge every per-IP limit.
   */
  TRUST_PROXY: int(1),
  ADMIN_EMAILS: csv,
  REQUIRE_EMAIL_VERIFICATION: flag(true),
  GOOGLE_CLIENT_ID: str,
  GOOGLE_CLIENT_SECRET: str,
  GITHUB_CLIENT_ID: str,
  GITHUB_CLIENT_SECRET: str,
  MAILER_DRIVER: z.enum(["console", "smtp", "resend"]).default("console"),
  SMTP_URL: str,
  RESEND_API_KEY: str,
  MAIL_FROM: str,
  STORAGE_DRIVER: z.enum(["local", "vercel-blob"]).default("local"),
  BLOB_READ_WRITE_TOKEN: str,
  UPLOAD_DIR: str,
  EMBEDDING_API_URL: str.default("https://api.openai.com/v1"),
  EMBEDDING_API_KEY: str,
  EMBEDDING_MODEL: str.default("text-embedding-3-small"),
  LISTMONK_URL: str,
  LISTMONK_USER: str,
  LISTMONK_API_TOKEN: str,
  LISTMONK_LIST_ID: str,
  LISTMONK_WEBHOOK_SECRET: str,
  WEB_REVALIDATE_URL: str,
  REVALIDATE_SECRET: str,
  CRON_SECRET: str,
  RATE_LIMIT_ENABLED: str,
  LOG_LEVEL: str,
  APP_VERSION: str,
  VERCEL_GIT_COMMIT_SHA: str,
});

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  nodeEnv: "development" | "production" | "test";
  isProd: boolean;
  isTest: boolean;
  version: string;
  databaseUrl: string;
  port: number;
  /** API prefix without trailing slash, `""` when mounted at the root. Default `/api`. */
  basePath: string;
  siteUrl: string;
  siteName: string;
  /** Public origin Better Auth builds links from (verification / reset URLs). */
  authUrl: string;
  apiInternalUrl: string;
  /** Normalised origins (scheme://host[:port]) allowed to make state-changing browser requests. */
  trustedOrigins: string[];
  trustProxy: number;
  authSecret: string;
  adminEmails: string[];
  requireEmailVerification: boolean;
  social: { google?: OAuthCredentials; github?: OAuthCredentials };
  mailer: { driver: "console" | "smtp" | "resend"; smtpUrl?: string; resendApiKey?: string; from: string };
  storage: { driver: "local" | "vercel-blob"; blobToken?: string; localDir: string };
  embedding: { url: string; apiKey?: string; model: string; enabled: boolean };
  listmonk: { url?: string; user?: string; apiToken?: string; listId?: string; webhookSecret?: string; enabled: boolean };
  revalidate: { url?: string; secret?: string };
  cronSecret?: string;
  rateLimit: { enabled: boolean };
  logLevel: string;
}

export const DEV_AUTH_SECRET = "dev-only-secret-do-not-use-in-production-0123456789";

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function normaliseBasePath(p: string): string {
  const trimmed = p.trim().replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Parse + validate process env (or any env-like object). Throws a readable error on invalid values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === "production";
  const isTest = e.NODE_ENV === "test";

  let authSecret = e.BETTER_AUTH_SECRET;
  if (!authSecret) {
    if (isProd) throw new Error("BETTER_AUTH_SECRET is required in production (use a random string of at least 32 characters).");
    authSecret = DEV_AUTH_SECRET;
  } else if (isProd && authSecret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters in production.");
  } else if (isProd && (authSecret === DEV_AUTH_SECRET || /^(change-?me|changeme|secret$|password$)/i.test(authSecret))) {
    // the placeholder values shipped in .env.example / dev defaults are public: sessions signed with them can be forged
    throw new Error("BETTER_AUTH_SECRET is still a placeholder value; generate a real one (openssl rand -base64 32).");
  }

  const devOrigins = isProd ? [] : ["http://localhost:3000", "http://localhost:3001", "http://localhost:4000"];
  const trustedOrigins = [
    ...new Set(
      [e.SITE_URL, e.BETTER_AUTH_URL, ...e.TRUSTED_ORIGINS, ...devOrigins]
        .map((u) => origin(u))
        .filter((o): o is string => Boolean(o)),
    ),
  ];

  const oauth = (id?: string, secret?: string): OAuthCredentials | undefined =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;
  const embeddingKey = e.EMBEDDING_API_KEY;
  const listmonkEnabled = Boolean(e.LISTMONK_URL && (e.LISTMONK_API_TOKEN || e.LISTMONK_USER));

  return {
    nodeEnv: e.NODE_ENV,
    isProd,
    isTest,
    version: e.APP_VERSION ?? e.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    databaseUrl: e.DATABASE_URL,
    port: e.API_PORT,
    basePath: normaliseBasePath(e.API_BASE_PATH),
    siteUrl: e.SITE_URL.replace(/\/+$/, ""),
    siteName: e.SITE_NAME,
    authUrl: e.BETTER_AUTH_URL.replace(/\/+$/, ""),
    apiInternalUrl: e.API_INTERNAL_URL.replace(/\/+$/, ""),
    trustedOrigins,
    trustProxy: e.TRUST_PROXY,
    authSecret,
    adminEmails: e.ADMIN_EMAILS.map((s) => s.toLowerCase()),
    requireEmailVerification: e.REQUIRE_EMAIL_VERIFICATION,
    social: {
      google: oauth(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET),
      github: oauth(e.GITHUB_CLIENT_ID, e.GITHUB_CLIENT_SECRET),
    },
    mailer: {
      driver: e.MAILER_DRIVER,
      smtpUrl: e.SMTP_URL,
      resendApiKey: e.RESEND_API_KEY,
      from: e.MAIL_FROM ?? `${e.SITE_NAME} <no-reply@localhost>`,
    },
    storage: {
      driver: e.STORAGE_DRIVER,
      blobToken: e.BLOB_READ_WRITE_TOKEN,
      localDir: e.UPLOAD_DIR ?? ".data/uploads",
    },
    embedding: {
      url: e.EMBEDDING_API_URL,
      apiKey: embeddingKey,
      model: e.EMBEDDING_MODEL,
      enabled: Boolean(embeddingKey),
    },
    listmonk: {
      url: e.LISTMONK_URL?.replace(/\/+$/, ""),
      user: e.LISTMONK_USER,
      apiToken: e.LISTMONK_API_TOKEN,
      listId: e.LISTMONK_LIST_ID,
      webhookSecret: e.LISTMONK_WEBHOOK_SECRET,
      enabled: listmonkEnabled,
    },
    revalidate: { url: e.WEB_REVALIDATE_URL, secret: e.REVALIDATE_SECRET },
    cronSecret: e.CRON_SECRET,
    rateLimit: { enabled: e.RATE_LIMIT_ENABLED ? !["0", "false", "no", "off"].includes(e.RATE_LIMIT_ENABLED.toLowerCase()) : !isTest },
    logLevel: e.LOG_LEVEL ?? (isTest ? "silent" : isProd ? "info" : "debug"),
  };
}

/**
 * Non-fatal production misconfigurations worth a log line at startup (the app still boots: optional integrations must
 * degrade gracefully). Returned as plain strings so they are easy to test.
 */
export function configWarnings(config: Config, env: Record<string, string | undefined> = process.env): string[] {
  if (!config.isProd) return [];
  const out: string[] = [];
  const local = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);
  if (local(config.siteUrl)) out.push("SITE_URL points at localhost in production: links in emails, RSS and CSRF/trusted origins will be wrong.");
  if (local(config.authUrl)) out.push("BETTER_AUTH_URL points at localhost in production: verification / reset links and cookies will not work for real visitors.");
  if (!env.DATABASE_URL || local(config.databaseUrl)) out.push("DATABASE_URL is unset or points at localhost in production.");
  if (!config.cronSecret) out.push("CRON_SECRET is not set: /cron/* answers 503, so scheduled posts and newsletters are never published.");
  if (config.mailer.driver === "console") out.push("MAILER_DRIVER=console in production: no email (verification, password reset, newsletter confirmation) is delivered.");
  if (config.storage.driver === "local") out.push("STORAGE_DRIVER=local in production: uploads live on the (ephemeral) function filesystem; use vercel-blob.");
  if (config.listmonk.enabled && !config.listmonk.webhookSecret) out.push("LISTMONK_WEBHOOK_SECRET is not set: listmonk bounce/unsubscribe webhooks are rejected.");
  if (config.revalidate.url && !config.revalidate.secret) out.push("WEB_REVALIDATE_URL is set without REVALIDATE_SECRET: the web app will (rightly) reject cache revalidation.");
  return out;
}
