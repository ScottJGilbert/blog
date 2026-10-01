import { toNodeHandler } from "better-auth/node";
import express, { type Express, type Request } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { loadSession } from "./auth";
import { createDeps, type Deps, type DepsOverrides } from "./deps";
import { HttpError, forbidden } from "./errors";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import { buildRouter } from "./routes";

/** Better Auth reads request bodies without any size limit; its payloads are tiny (credentials, a name, a token). */
export const AUTH_BODY_LIMIT_BYTES = 64 * 1024;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** `/admin/posts…` and `/admin/newsletters…` carry Lexical documents (inline `data:` images): larger body, parsed AFTER the admin check. */
export const LARGE_JSON_ROUTE = /^\/admin\/(posts|newsletters)(\/|$)/;

export interface AppWithDeps {
  app: Express;
  deps: Deps;
}

/**
 * Build the Express app. Everything external is injectable (db, mailer, storage, newsletter/embedding providers,
 * clock, fetch, …): `createApp({ db, mailer: new MemoryMailer(), now: () => fixedDate })`.
 */
export function createAppWithDeps(overrides: DepsOverrides = {}): AppWithDeps {
  const deps = createDeps(overrides);
  const { config, logger } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("etag", "weak");
  app.locals.deps = deps;

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request & { id: string }).id,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
      // Never log query strings (they can carry one-time tokens) or headers.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.split("?")[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url?.endsWith("/health") ?? false },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

  // --- Better Auth: must see the raw body, so it is mounted BEFORE express.json() ---------------------------------
  const authBase = `${config.basePath}/auth`;
  const authNode = toNodeHandler(deps.auth);
  app.all([`${authBase}/*splat`, "/auth/*splat"], async (req, res, next) => {
    // Vercel Services may strip the `/api` prefix: normalise so Better Auth always sees its configured basePath.
    if (!req.url.startsWith(authBase)) req.url = `${config.basePath}${req.url}`;
    if (!SAFE_METHODS.has(req.method)) {
      await new Promise<void>((resolve, reject) => deps.limiters.auth(req, res, (e) => (e ? reject(e) : resolve())));
      // bounded body: declared length first (chunked uploads are counted below)
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > AUTH_BODY_LIMIT_BYTES) throw new HttpError(413, "validation_error", "Request body too large");
      // A suspended account must not keep using its (not yet revoked) session on Better Auth's endpoints either
      // (update-user, change-password …). Signing out stays possible.
      if (req.headers.cookie && !/\/sign-out\/?$/.test(req.path)) {
        const s = await loadSession(req);
        if (s?.banned) throw forbidden("This account has been suspended.");
      }
      // Running byte count. Attached in the same tick as Better Auth's own reader (no `await` between this and `authNode`),
      // so the stream is never consumed before Better Auth sees it.
      let received = 0;
      req.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > AUTH_BODY_LIMIT_BYTES && !res.headersSent) {
          res.status(413).set("connection", "close").json({ error: { code: "validation_error", message: "Request body too large" } });
          req.destroy();
        }
      });
    }
    await authNode(req, res);
  });

  // Everything is 1 MB, except the admin post/newsletter routes: they may carry inline `data:` images from the editor
  // (externalised server-side), so they get a larger limit (Vercel's request cap is 4.5 MB). That bigger parser runs inside
  // the router AFTER requireAdmin (routes/index.ts): anonymous callers can never make us buffer 4 MB.
  const smallJson = express.json({ limit: "1mb" });
  app.use((req, res, next) => {
    // `req.path` here is relative to the mount point; the route may be reached with or without the API prefix
    const path = config.basePath && req.path.startsWith(`${config.basePath}/`) ? req.path.slice(config.basePath.length) : req.path;
    return LARGE_JSON_ROUTE.test(path) ? next() : smallJson(req, res, next);
  });

  const router = buildRouter(deps);
  app.use(config.basePath || "/", router);
  if (config.basePath) app.use("/", router);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return { app, deps };
}

export function createApp(overrides: DepsOverrides = {}): Express {
  return createAppWithDeps(overrides).app;
}
