import { toNodeHandler } from "better-auth/node";
import express, { type Express, type Request } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { createDeps, type Deps, type DepsOverrides } from "./deps";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import { buildRouter } from "./routes";

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
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      await new Promise<void>((resolve, reject) => deps.limiters.auth(req, res, (e) => (e ? reject(e) : resolve())));
    }
    await authNode(req, res);
  });

  // Post/newsletter bodies may carry inline `data:` images from the editor (externalised server-side), so those
  // routes get a larger limit (Vercel's request cap is 4.5 MB); everything else stays at 1 MB.
  const largeJson = express.json({ limit: "4mb" });
  const smallJson = express.json({ limit: "1mb" });
  app.use((req, res, next) =>
    /\/admin\/(posts|newsletters)(\/|$)/.test(req.path) ? largeJson(req, res, next) : smallJson(req, res, next),
  );

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
