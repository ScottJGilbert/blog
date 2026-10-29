import type { Database } from "@blog/db";
import { type Options, type Store, ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import type { Config } from "../config";
import { HttpError } from "../errors";
import { PgRateLimitStore } from "./pg-rate-limit-store";

type Limiter = RequestHandler;
const passthrough: Limiter = (_req, _res, next) => next();

export interface LimiterOptions {
  /** window length in ms */
  windowMs: number;
  /** max requests per window per key (or a function of the request) */
  limit: number | ((req: Request) => number);
  /** default: client IP */
  key?: (req: Request) => string;
  /** message of the 429 */
  message?: string;
  /** Counter storage. Default: in memory, i.e. PER INSTANCE (fine locally, an approximation across serverless instances). */
  store?: Store;
}

const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? "unknown");

/** Build one express-rate-limit middleware that fails with the SPEC `rate_limited` envelope. Pass `enabled=false` for a no-op. */
export function makeLimiter(enabled: boolean, o: LimiterOptions): Limiter {
  if (!enabled) return passthrough;
  const options: Partial<Options> = {
    windowMs: o.windowMs,
    limit: typeof o.limit === "function" ? (req) => (o.limit as (r: Request) => number)(req) : o.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: o.key ?? ipKey,
    ...(o.store ? { store: o.store, passOnStoreError: true } : {}), // a limiter outage must not become an auth outage
    handler: (_req, _res, next, opt) => {
      next(new HttpError(429, "rate_limited", o.message ?? "Too many requests, please try again later", { headers: { "retry-after": String(Math.ceil(opt.windowMs / 1000)) } }));
    },
  };
  return rateLimit(options);
}

export interface RateLimiters {
  /** Better Auth endpoints: 10 / min / IP (applied to non-GET requests by the app). */
  auth: Limiter;
  /** Comment creation: 10 / min / user (falls back to IP). Place AFTER `requireUser`. */
  commentCreate: Limiter;
  /** Newsletter subscribe/confirm/unsubscribe: 5 / min / IP. */
  subscribe: Limiter;
  /** Public reads: 120 / min / IP, 1200 / min for a verified API key (`req.apiKey`, set by the v1 key middleware before this). */
  publicRead: Limiter;
  /** Authenticated admin API: generous 600 / min / IP (runs before the session is known), mostly a runaway-script guard. */
  admin: Limiter;
  /** `/v1` requests that present an API key: 1200 / min / IP, applied BEFORE the key lookup so guessing keys cannot hammer the database. */
  apiKeyAttempt: Limiter;
}

/**
 * The standard presets (SPEC §5). Disabled (pass-through) when `config.rateLimit.enabled` is false (RATE_LIMIT_ENABLED=0; the default under NODE_ENV=test).
 *
 * Counters live in memory, which on serverless means per instance: a burst spread over N warm instances gets N times the
 * budget. The abuse-sensitive presets (auth, commentCreate, subscribe) therefore use the shared Postgres store when
 * `config.rateLimit.store === "postgres"` (the default on Vercel); the high-volume read/admin presets stay in memory.
 */
export function createRateLimiters(config: Pick<Config, "rateLimit">, db?: Pick<Database, "execute">): RateLimiters {
  const enabled = config.rateLimit.enabled;
  const MIN = 60_000;
  const shared = (prefix: string): Store | undefined => (db && config.rateLimit.store === "postgres" ? new PgRateLimitStore(db, prefix) : undefined);
  return {
    auth: makeLimiter(enabled, { windowMs: MIN, limit: 10, message: "Too many authentication attempts, please wait a minute.", store: shared("auth:") }),
    commentCreate: makeLimiter(enabled, {
      windowMs: MIN,
      limit: 10,
      key: (req) => (req.user ? `user:${req.user.id}` : ipKey(req)),
      message: "You are commenting too quickly, please wait a minute.",
      store: shared("comment:"),
    }),
    subscribe: makeLimiter(enabled, { windowMs: MIN, limit: 5, message: "Too many subscription requests, please wait a minute.", store: shared("subscribe:") }),
    publicRead: makeLimiter(enabled, {
      windowMs: MIN,
      limit: (req) => (req.apiKey ? 1200 : 120),
      key: (req) => (req.apiKey ? `key:${req.apiKey.id}` : ipKey(req)),
    }),
    admin: makeLimiter(enabled, { windowMs: MIN, limit: 600, key: (req) => (req.user ? `user:${req.user.id}` : ipKey(req)) }),
    apiKeyAttempt: makeLimiter(enabled, { windowMs: MIN, limit: 1200, key: (req) => `apikey-attempt:${ipKey(req)}` }),
  };
}
