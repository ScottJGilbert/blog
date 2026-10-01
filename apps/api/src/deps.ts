import { getDb, type Database } from "@blog/db";
import type { Request } from "express";
import { createAuth, type Auth } from "./auth";
import { loadConfig, type Config } from "./config";
import { createLogger, type Logger } from "./logger";
import { createRateLimiters, type RateLimiters } from "./middleware/rate-limit";
import { createRevalidator, type Revalidator } from "./lib/revalidate";
import { createEmbeddingProvider, type EmbeddingProvider } from "./services/embeddings";
import { createMailer, type Mailer } from "./services/mailer";
import { createNewsletterProvider, type NewsletterProvider } from "./services/newsletter";
import { createStorage, type Storage } from "./services/storage";

/**
 * Everything a route needs from the outside world. Routers are built as `xRouter(deps)`; tests inject fakes
 * (see `test/helpers.ts`). Add new collaborators here, never import singletons in route code.
 */
export interface Deps {
  config: Config;
  logger: Logger;
  db: Database;
  mailer: Mailer;
  storage: Storage;
  newsletter: NewsletterProvider;
  embeddings: EmbeddingProvider;
  /** Best-effort web cache revalidation (`revalidate(["posts", "post:slug"])`); never throws. */
  revalidate: Revalidator;
  /** Clock. Use `deps.now()` instead of `new Date()` in logic that tests need to control. */
  now: () => Date;
  fetch: typeof fetch;
  /** express-rate-limit presets (`deps.limiters.commentCreate`, …). */
  limiters: RateLimiters;
  /** Better Auth instance (built from the other deps unless overridden). */
  auth: Auth;
}

export type DepsOverrides = Partial<Deps>;

export function createDeps(overrides: DepsOverrides = {}): Deps {
  const config = overrides.config ?? loadConfig();
  const logger = overrides.logger ?? createLogger(config);
  const fetchImpl = overrides.fetch ?? fetch;
  const db = overrides.db ?? getDb();
  const mailer = overrides.mailer ?? createMailer(config, logger, fetchImpl);
  const base = {
    config,
    logger,
    db,
    mailer,
    storage: overrides.storage ?? createStorage(config, logger),
    newsletter: overrides.newsletter ?? createNewsletterProvider(config, logger, fetchImpl),
    embeddings: overrides.embeddings ?? createEmbeddingProvider(config, fetchImpl),
    revalidate: overrides.revalidate ?? createRevalidator(config, logger, fetchImpl),
    now: overrides.now ?? (() => new Date()),
    fetch: fetchImpl,
    limiters: overrides.limiters ?? createRateLimiters(config),
  };
  return { ...base, auth: overrides.auth ?? createAuth({ config, db, mailer, logger }) };
}

/** The deps of the running app (for middleware that only receives `req`). */
export function getDeps(req: Request): Deps {
  return req.app.locals.deps as Deps;
}
