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

## 1. Database (Neon)
Create a Neon project, enable `vector` (`CREATE EXTENSION vector` — migration `0000` does it), copy the **pooled** connection string to `DATABASE_URL`.
Run migrations from your machine or CI: `DATABASE_URL=… pnpm db:migrate`. (Optionally `pnpm db:seed` for demo content in non-production.)

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
`docker compose up -d` (Postgres+pgvector, listmonk) or any local Postgres with pgvector, then `cp .env.example .env`, `pnpm install`, `pnpm db:migrate && pnpm db:seed`, `pnpm dev`
(web :3000 proxies `/api` → :4000 and `/admin` → :3001; open http://localhost:3000).
