# @blog/api

Express 5 + TypeScript API for the blog platform (contract: `docs/SPEC.md` §5). ESM, bundled for Vercel with `tsup`.

```bash
pnpm --filter @blog/db migrate && pnpm --filter @blog/db seed   # once (needs Postgres + pgvector)
pnpm --filter @blog/api dev          # tsx watch on :4000 (API_PORT)
pnpm --filter @blog/api test         # vitest, real Postgres (TEST_DATABASE_URL)
pnpm --filter @blog/api build        # → dist/index.js
pnpm --filter @blog/api start        # node dist/index.js (listens on API_PORT)
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
* Request bodies: 1 MB JSON everywhere; 4 MB only for `/admin/posts…` and `/admin/newsletters…` and only AFTER `requireAdmin`; Better Auth routes 64 KB; uploads 8 MB (multer) plus a pixel guard (≤ 16384 px per side, ≤ 100 MP).
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
