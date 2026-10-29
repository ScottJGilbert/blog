# Deployment

Everything except listmonk runs on Vercel as **one project with three services** on a single domain
(see [Vercel Services](https://vercel.com/docs/services), configured via `experimentalServices` in the root `vercel.json`):

| Service | Entrypoint | Route prefix | Notes |
| --- | --- | --- | --- |
| `web` | `apps/web` (Next.js 16) | `/` | public site; also serves `/feed.xml`, `/sitemap.xml`, `/internal/revalidate` |
| `admin` | `apps/admin` (Next.js 16, `basePath: /admin`) | `/admin` | admin role required |
| `api` | `apps/api/src/index.ts` (Express 5) | `/api` | Better Auth at `/api/auth/*`; also answers un-prefixed in case Vercel strips the prefix |

Vercel Services is an experimental feature: in the project settings set the **Framework Preset to "Services"**, and
verify against the current docs that the prefix handling (`basePath` for admin, prefix stripping for the API) behaves as
described. The API mounts its router at both `/api` and `/`, and admin sets `basePath` explicitly, to be robust to either.

## 1. Database (Supabase Postgres)
Supabase is used **only as managed Postgres + pgvector**. We do not use supabase-js, Supabase Auth, Storage or the Data API (PostgREST): auth is
Better Auth in the API, media is Vercel Blob, and every query goes through `pg`/Drizzle straight to Postgres.

**Create the project**: new Supabase project in a region close to your Vercel functions; pick a database password (letters and digits are easiest;
if it contains `@ # / : ? %` it must be percent-encoded inside the URL). Use a separate project (or at least a separate database) for production and previews.
Either install the **Supabase integration from the Vercel Marketplace** (it injects `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`,
`POSTGRES_HOST/USER/PASSWORD/DATABASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`) or copy strings by hand from
**Project → Connect** (formerly *Settings → Database → Connection string*) into Vercel env vars. The code reads, in this order:

| What | Variable (first one set wins) | Which Supabase string |
| --- | --- | --- |
| Runtime queries (API) | `DATABASE_URL`, else `POSTGRES_URL` | **Transaction pooler**, port **6543** (`postgres://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:6543/postgres`). The user is `postgres.<ref>` on every pooler host. |
| Migrations / seed | `DATABASE_URL_UNPOOLED`, else `POSTGRES_URL_NON_POOLING` | **Session pooler** (port 5432, IPv4) or the **direct** string (`db.<ref>.supabase.co:5432`, IPv6-only on free plans). Optional: without it migrations run through the transaction pooler. |

The `SUPABASE_*` / `POSTGRES_PRISMA_URL` variables are unused. `SUPABASE_SERVICE_ROLE_KEY` bypasses row level security and `SUPABASE_JWT_SECRET` can mint any token:
do not expose them to the three services (remove or unscope them in the Vercel project) and rotate them if they ever leaked.

* **IPv4**: Vercel functions and builds have IPv4-only egress. The direct host `db.<ref>.supabase.co` has no IPv4 address on free plans, so the runtime must use the pooler URL
  (`/api/health` operators get a config warning when `DATABASE_URL` is a direct host on Vercel). The build-time migration prefers the direct/session URL and **automatically falls back to the pooled URL**
  (logging why) when `db.<ref>.supabase.co` is unreachable (`ENETUNREACH`, `EADDRNOTAVAIL`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`).
* **Transaction pooler (Supavisor, port 6543)**: no session state survives between statements. The code therefore uses no `SET`, `LISTEN`, session advisory locks or named prepared statements
  (a test records every statement a migration issues), skips the optional `application_name` startup parameter on pooler hosts, and strips the `supa=…`, `pgbouncer`, `connection_limit` URL parameters before they reach `pg`.
  Migrations on a 6543 URL work but are not serialised by an advisory lock (the session lock is taken only on direct/session URLs): avoid running two migrations at once.
* **Connection limits**: free plans have a small connection budget. Each Vercel instance keeps at most **3** connections (`DATABASE_POOL_MAX` overrides) and closes idle ones after 5 s; the pooler multiplexes them onto the database.
* **TLS**: Supabase certificates chain to a Supabase CA that is *not* in Node's trust store, and `pg` treats `sslmode=require` as strict verification, which fails with `self-signed certificate in certificate chain`. Options:
  1. **Recommended**: download the CA (*Project → Database settings → SSL Configuration → Download certificate*) and set `DATABASE_SSL_CA` to the PEM or its base64 (`base64 -w0 prod-ca-2021.crt`). The chain and hostname are then verified.
     If the pooler presents a certificate for a different hostname, add `DATABASE_SSL=verify-ca` (chain only; **unverified against a real project**, see risks below).
  2. **Default for `*.supabase.com` / `*.supabase.co` without a CA**: TLS with `rejectUnauthorized: false`: traffic is encrypted but a man-in-the-middle would not be detected. A warning is logged once per instance.
  3. `DATABASE_SSL=no-verify`: the same, explicitly, for any host. Other hosts are never downgraded implicitly (`sslmode=require` stays strict); `sslmode=disable` (local Postgres) turns TLS off.
* **pgvector**: enable it under *Database → Extensions → vector* (Supabase puts it in the `extensions` schema), or let migration `0000` do it: the migrator creates it `WITH SCHEMA extensions` when that schema exists and
  runs the migrations with `SET LOCAL search_path` including it. Runtime queries look the extension's schema up once and schema-qualify `vector` and `<=>`, so nothing depends on the connection's `search_path` (a pooler cannot `SET` it).
  The HNSW index and the search/related-posts SQL are covered by tests with the extension in `public` and in `extensions`.
* **Migrations**: `DATABASE_URL_UNPOOLED=… pnpm db:migrate` from your machine/CI, or at build time (below). After each run the Data API lockdown is re-applied.
* **Build-time migrations** (for when nobody can reach Postgres from a shell): the `api` service build (`pnpm --filter @blog/api build`) first runs `packages/db/src/migrate-on-build.ts`.
  `MIGRATE_ON_BUILD=1` migrates in any environment, `MIGRATE_ON_BUILD=0` never; unset = only on `VERCEL_ENV=preview` when a database URL exists; local builds never migrate. It logs `[migrate-on-build] …` lines (host only, never the URL/password),
  uses a 15 s connect timeout and a 5 min overall limit, and **any failure fails the build** (with a hint for TLS / pooler-user / password errors).
  `SEED_ON_BUILD=1` then seeds demo tags and posts (existing posts are left alone) plus **your** accounts: `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (>= 16 characters, not a known default) and optionally a verified reader
  `SEED_READER_EMAIL` + `SEED_READER_PASSWORD` for end-to-end tests. Missing or weak values are refused with a loud log line and no account is created. On Vercel the public demo accounts (`admin@example.com` …) are **never** created.
  Existing accounts keep their password unless `SEED_RESET_PASSWORDS=1`. The seed is skipped in `VERCEL_ENV=production` (run `pnpm db:seed` by hand if you really want demo content there). Remove `SEED_*` once the accounts exist.
* **Data API lockdown (important)**: Supabase exposes schema `public` through PostgREST to the **public** anon key and to every signed-in `authenticated` user, and tables created by SQL migrations have row level security *off* and are granted to those
  roles by default: anyone holding the anon key (it ships in every Supabase client bundle and is easy to find) could read `user`, `session`, `account` (password hashes, tokens) and write to the rest. Migration `0003_supabase_lockdown` therefore
  enables RLS (with no policies, i.e. deny-all) on every table of `public` and `drizzle`, revokes all privileges on tables/sequences/functions of `public` from `anon` and `authenticated`, and revokes the default privileges for future objects.
  It does nothing unless those roles exist (plain Postgres, local). RLS is deliberately not `FORCE`d: the app connects as the table owner (`postgres`, which also has `BYPASSRLS`), and forcing it would apply RLS to the owner too.
  `runMigrations` re-applies the same statements after every run, so a table added by a later migration is covered even if its author forgot. **Admin → Settings → Database** shows `Supabase Data API: locked` (or a red warning when any `public`
  table is still reachable by anon/authenticated; also `GET /api/admin/system` → `dataApiExposure: locked | open | n/a`). The runtime role must own the tables (or have `BYPASSRLS`), which holds when migrations and the app use the same `postgres.<ref>` login.
  Belt and braces in the dashboard: *Project Settings → Data API* → turn the Data API off (or remove `public` from *Exposed schemas*). If you ever add a table through the Supabase dashboard, run `pnpm db:migrate` again.

## 2. Environment variables (Vercel project → all three services share them)
Required: `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 random chars), `BETTER_AUTH_URL` and `SITE_URL` (`https://your-domain`), `ADMIN_EMAILS`,
`API_INTERNAL_URL` (the API origin as seen from the web/admin server runtimes — normally `https://your-domain`), `REVALIDATE_SECRET`, `WEB_REVALIDATE_URL` (`https://your-domain/internal/revalidate`), `CRON_SECRET`.
Mail: `MAILER_DRIVER=resend|smtp`, `RESEND_API_KEY` or `SMTP_URL`, `MAIL_FROM`.
Media: `STORAGE_DRIVER=vercel-blob`, `BLOB_READ_WRITE_TOKEN`, and `NEXT_PUBLIC_MEDIA_HOST` (the blob store host) for web `next/image`.
Optional: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` (+ `NEXT_PUBLIC_AUTH_GOOGLE=1` / `NEXT_PUBLIC_AUTH_GITHUB=1` for the buttons),
`EMBEDDING_API_URL/KEY/MODEL` (semantic search/related posts), `LISTMONK_*` (see `docs/NEWSLETTERS.md`).
The first admin: sign up with an address listed in `ADMIN_EMAILS` and verify the email (or `pnpm --filter @blog/api make-admin you@example.com`).

## 3. Listmonk
Run listmonk in a container host (Railway / Fly.io / Render): see `docker-compose.yml` and `docs/NEWSLETTERS.md`. Only the API talks to it.

## 4. Cron
`vercel.json` ships a **daily** cron hitting `/api/cron/publish-scheduled` (Vercel Hobby only allows daily crons). It publishes due scheduled posts and sends due newsletters.
For minute-level precision use Vercel Pro (`* * * * *`) or an external scheduler calling the URL with `Authorization: Bearer $CRON_SECRET`.

## 5. Local single-origin dev
Without Docker: any local Postgres with pgvector, `cp .env.example .env`, `pnpm install`, `pnpm db:migrate && pnpm db:seed`, `pnpm dev`
(web :3000 proxies `/api` → :4000 and `/admin` → :3001; open http://localhost:3000).
With Docker (full stack behind a Caddy reverse proxy that mirrors the Vercel Services routing): `docker compose up --build`, see [`LOCAL_DEV.md`](LOCAL_DEV.md).

## Vercel Services notes (learned from real preview deployments)
* Use `services` + top-level `rewrites` (the `experimentalServices` / `routePrefix` form is deprecated). Rewrites hand the ORIGINAL path to the service, so the API keeps its `/api` prefix and admin keeps its `/admin` basePath.
* A service `entrypoint` is validated BEFORE the build, so it cannot point into `dist/`. `apps/api/entry.cjs` is a committed shim that requires the tsup bundle `dist/index.cjs`.
* `bindings` inject an absolute internal URL (e.g. `https://api.<id>.services.vercel-infra.com`) that is not subject to Deployment Protection: web and admin get `API_INTERNAL_URL` this way.
* Bindings must not be circular (`CIRCULAR_SERVICE_BINDING`), so the API cannot bind web. It revalidates web via the deployment URL and the `x-vercel-protection-bypass` header (`VERCEL_AUTOMATION_BYPASS_SECRET`, create it once under Project → Deployment Protection → Protection Bypass for Automation).
* **Image optimization:** `/_next/image` (and `/_vercel/image`) answer with the web app's 404 page behind a service rewrite, so `next/image` is configured `unoptimized` on Vercel (`apps/web/next.config.ts`; `IMAGE_OPTIMIZATION=1` opts back in). Uploads are capped at 4 MB.
* **Supabase integration variables are prefixed** by the store name (e.g. `SUPABASE_STORAGE_POSTGRES_URL`); the DB client accepts `DATABASE_URL`, `POSTGRES_URL`, or any `*_POSTGRES_URL` (and the `*_POSTGRES_URL_NON_POOLING` equivalent). Remove the unused `*_SERVICE_ROLE_KEY`, `*_SECRET_KEY` and `*_JWT_SECRET` from the project env: nothing here uses them and they bypass RLS.
* **Better Auth keeps its own per-instance limiter** (e.g. 3 sign-ins per 10 s per IP); our shared Postgres-backed limiters sit on top for comments, subscribe and auth writes.
* **Previews run `pnpm db:migrate` and (optionally) the preview seed at API build time** (`packages/db/src/migrate-on-build.ts`): `SEED_ON_BUILD=1`, `SEED_ADMIN_EMAIL/PASSWORD`, `SEED_READER_EMAIL/PASSWORD`. Production builds migrate only with `MIGRATE_ON_BUILD=1` and never seed.
* **End-to-end tests for a preview** live in `e2e/preview/` (`preview.e2e.mjs`, `deep.e2e.mjs`, `browser.e2e.mjs`); they need `BASE`, `BYPASS` (Protection Bypass for Automation secret) and the seeded account credentials, and can be run from a Vercel Sandbox because third-party networks may block `*.vercel.app`.
