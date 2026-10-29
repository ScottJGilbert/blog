# @blog/api

Express 5 + TypeScript API for the blog platform (contract: `docs/SPEC.md` §5). ESM, bundled for Vercel with `tsup`.

```bash
pnpm --filter @blog/db migrate && pnpm --filter @blog/db seed   # once (needs Postgres + pgvector)
pnpm --filter @blog/api dev          # tsx watch on :4000 (API_PORT)
pnpm --filter @blog/api test         # vitest, real Postgres (TEST_DATABASE_URL)
pnpm --filter @blog/api build        # → dist/index.cjs (one self-contained CommonJS file)
pnpm --filter @blog/api start        # node dist/index.cjs (listens on API_PORT)
pnpm --filter @blog/api make-admin you@example.com
```

Demo logins after seeding: `admin@example.com / admin-password-123`, `reader@example.com / reader-password-123`.

## Structure

```
src/
  index.ts            Vercel entry: `export default app` (also listens when run directly)
  dev.ts              local dev server
  app.ts              createApp(overrides) / createAppWithDeps(overrides) → { app, deps }
  config.ts           zod-parsed env → typed Config (SPEC §3 defaults)
  deps.ts             Deps (db, mailer, storage, newsletter, embeddings, revalidate, limiters, now, fetch, auth) + createDeps
  auth.ts             Better Auth instance, getSessionUser(req), revokeUserSessions(db, userId)
  errors.ts           HttpError + badRequest/unauthorized/forbidden/notFound/conflict/… helpers
  middleware/         auth (requireUser…), csrf, cors (v1Cors), rate-limit (createRateLimiters), error-handler, request-id
  lib/                validate (parse*), pagination, audit, revalidate, crypto, async-handler
  services/           mailer/ storage/ newsletter/ embeddings/   (interface + drivers, each with a `create…()` factory)
  routes/
    index.ts          route registry (buildRouter) — mounted at API_BASE_PATH and at /
    health.ts me.ts media-files.ts      implemented in the skeleton
    public/index.ts   publicRouter(deps)   — WP B1
    admin/index.ts    adminRouter(deps)    — WP B2 (already behind requireAdmin)
    v1/index.ts       v1Router(deps)       — WP B2 (CORS * already applied)
    cron.ts           cronRouter(deps)     — WP B2 (bearer CRON_SECRET)
  scripts/make-admin.ts
test/helpers.ts       buildTestApp, signUpAndSignIn, anonAgent, createUser, MemoryMailer…
```

### Request pipeline
`request-id → pino-http → helmet → [Better Auth at /api/auth/* and /auth/*, own rate limit] → express.json(1 MB) →
router (CSRF origin check → health, me, media files, /v1 (CORS), /cron, /admin (limiter + requireAdmin), public) → 404 → error handler`.
The same router is mounted at `API_BASE_PATH` (default `/api`) and `/`, because Vercel Services may strip the prefix.

### Errors
Throw `HttpError`s (or let zod throw): the handler answers `{ error: { code, message, details? } }`.
`ZodError` → 400 `validation_error` + `details` (zod issues). Anything else → 500 `internal`, message never leaked (logged with the request id).

## Adding a route (B1/B2)

```ts
// routes/public/posts.ts
import { ListPostsQuerySchema, PostSummarySchema } from "@blog/shared";
import { Router } from "express";
import type { Deps } from "../../deps";
import { paginated } from "../../lib/pagination";
import { parseQuery } from "../../lib/validate";

export function postsRouter(deps: Deps): Router {
  const router = Router();
  router.get("/posts", deps.limiters.publicRead, async (req, res) => {
    const q = parseQuery(ListPostsQuerySchema, req);          // coerced + defaulted, throws → 400
    const offset = (q.page - 1) * q.pageSize;
    // … deps.db queries (drizzle) …
    paginated(res, { data: [], total: 0, page: q.page, pageSize: q.pageSize });
  });
  return router;
}
// routes/public/index.ts:  router.use(postsRouter(deps));
```

* Auth: `requireUser`, `requireVerifiedUser`, `requireAdmin`, `optionalUser` (from `middleware/auth`) set `req.user`
  (`{ id, name, email, image, role, emailVerified }`). `getSessionUser(req)` (from `auth`) is the non-middleware form.
* Admin mutations: `await audit(deps.db, req.user, { action: "post.publish", targetType: "post", targetId: id, meta })`
  (pass a transaction as first argument to make it atomic). After publish/unpublish/delete: `await deps.revalidate(postTags(post))`.
* Rate limits (`deps.limiters`): `auth`, `commentCreate` (place after `requireUser`), `subscribe`, `publicRead`, `admin`.
* Time: use `deps.now()`; send mail with `deps.mailer.send({ to, ...verifyEmail(...) })`; files via `deps.storage`.
* Pagination: `parsePagination(req.query)` / `pageParams(req)` and `paginated(res, { data, total, page, pageSize })`.
* Never import singletons in route code; take what you need from `deps` so tests can inject fakes.

## Writing tests

```ts
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { anonAgent, buildTestApp, signUpAndSignIn, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => { t = await buildTestApp(); });   // own throw-away database, migrated
afterAll(() => t.close());
beforeEach(() => t.reset());                            // truncate all tables + clear mailbox/storage

it("admin only", async () => {
  await anonAgent(t).get("/api/admin/stats").expect(401);
  const { agent } = await signUpAndSignIn(t, { role: "admin" });   // real sign-in through Better Auth
  await agent.get("/api/admin/stats").expect(200);
});
```

* `buildTestApp({ env, deps })`: `env` goes through `loadConfig` (e.g. `{ ADMIN_EMAILS: "x@y.z", RATE_LIMIT_ENABLED: "1" }`);
  `deps` overrides any dependency (`newsletter`, `embeddings`, `now`, `revalidate`, `mailer`, `storage`, …).
  Default fakes: `MemoryMailer` (`t.mailer.outbox`, `.last(to)`, `findLink(mail, /verify/)`), `MemoryStorage`,
  `NoopProvider`, `DisabledProvider`, no-op `revalidate`.
* `createUser(t, { role, email, verified, banned })` inserts a user + credential account (real password hash) without signing in.
* Agents keep cookies and send `Origin: t.origin` (needed for cookie-authenticated writes). `t.reset()` also deletes sessions, so sign in again after it.
* Each test file gets its own database (`@blog/db/testing`), so files run in parallel; `TEST_DB_SHARED=1` uses `TEST_DATABASE_URL` directly.

## Security notes
* Request bodies: 1 MB JSON everywhere; 4 MB only for `/admin/posts…` and `/admin/newsletters…` and only AFTER `requireAdmin`; Better Auth routes 64 KB; uploads 4 MiB (multer; Vercel rejects bodies over 4.5 MB) plus a pixel guard (≤ 16384 px per side, ≤ 100 MP).
* CSRF: `routes/index.ts` checks `Origin` (else `Referer`) on every cookie-carrying write; Better Auth's own Origin / callback-URL validation is forced on in all environments (`disableOriginCheck: false`), so tests exercise what production runs.
* Database rejections caused by client data (NUL bytes, over-long values, constraint violations) are mapped to 4xx by the error handler, never a 500.
* `TRUST_PROXY` is a hop count (Vercel: 1, no proxy at all: 0) — see the comment in `config.ts`. Production refuses placeholder `BETTER_AUTH_SECRET`s and logs `configWarnings()` at startup.

## Auth notes
* Better Auth is mounted at `<API_BASE_PATH>/auth/*`; clients use `better-auth/client` with `baseURL` = the site origin.
* Email+password; verification is required to sign in (`REQUIRE_EMAIL_VERIFICATION=false` relaxes it). Emails go through `Mailer`.
* Roles `reader` (default) / `admin`; clients can never set them. `ADMIN_EMAILS` promotes on verification (or social sign-up);
  `make-admin` promotes explicitly.
* Ban = `user.banned` (+ `ban_reason`): sign-in is rejected, existing sessions stop working immediately (403), and
  `revokeUserSessions(db, userId)` deletes them. We do not use Better Auth's `admin` plugin.

## Serverless notes (Vercel, Fluid compute)
* **Entry/bundle**: `src/index.ts` default-exports the Express app and never listens on Vercel. `pnpm build` (tsup) inlines every
  dependency and the `@blog/*` TypeScript packages into `dist/index.cjs` (~7 MB, ~0.4 s to import; no `node_modules`, no
  `__dirname`/fs reads). Importing never throws: invalid env exports an app answering `503` and logs one JSON line naming
  the offending variables (`boot-failure.ts`).
* **Origins**: with `SITE_URL`/`BETTER_AUTH_URL` unset, the public origin is derived (`lib/origins.ts`): production domain in
  production, the deployment URL on previews. CSRF/Better Auth trust exactly the deployment URL, branch alias and production domain
  of the project plus `SITE_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` (no wildcards). Placeholder origins (`https://your-domain`) are rejected in production.
* **Service calls**: web/admin use `API_INTERNAL_URL` (any URL shape, `@blog/shared/server`); the API revalidates the web cache at
  `WEB_REVALIDATE_URL`, else `WEB_INTERNAL_URL + /internal/revalidate`, else the deployment URL. Calls to the project's own public hosts carry
  `x-vercel-protection-bypass` when `VERCEL_AUTOMATION_BYPASS_SECRET` exists.
* **After the response**: embeddings run through `deps.background` (`lib/background.ts`, Vercel `waitUntil`); revalidation, audit, mail and
  newsletter calls are awaited inline. Reindex is resumable and stops at `REINDEX_BUDGET_MS`; run it again to continue.
* **Statefulness**: memory is per instance. The auth / comment / subscribe limits count in Postgres (`rate_limit` table, `RATE_LIMIT_STORE`);
  the read/admin limits stay in memory (approximate across instances). The filesystem is read-only: without `BLOB_READ_WRITE_TOKEN` uploads answer 503.
* **Database**: use the pooled `DATABASE_URL` at runtime (no `SET`, `LISTEN`, session locks or startup parameters anywhere) and
  `DATABASE_URL_UNPOOLED` for migrations. Connectivity errors are mapped to `503` + `Retry-After`.
* **Diagnostics**: `GET /api/health` is `{status, db, version}`; with `Authorization: Bearer $CRON_SECRET` (or `x-revalidate-secret`) it adds
  `config: { missing: [env var names], warnings, resolved origins/drivers }`. Request ids come from `x-vercel-id`.
* Platform limits: request bodies 4.5 MB (uploads are capped at 4 MiB), set `maxDuration` ≥ 60 s for the API function (cron, reindex).
