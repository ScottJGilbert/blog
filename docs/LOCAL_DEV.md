# Local development with Docker Compose

`docker-compose.yml` runs the **whole platform** locally, independent of Vercel. A [Caddy](https://caddyserver.com) reverse proxy
(`docker/caddy/Caddyfile`) reproduces the production routing of Vercel Services on a single origin, so cookies, CSRF/origin checks and
links behave exactly like production:

```
 browser ─▶ caddy :3000 ─┬─ /api/*    ─▶ api   :4000  (Express, prefix kept)
                         ├─ /admin/*  ─▶ admin :3001  (Next.js, basePath /admin)
                         └─ everything else ─▶ web :3000 (Next.js; /_next, /feed.xml, /sitemap.xml, /internal/revalidate)
 api ─▶ db (Postgres + pgvector) · mailpit (SMTP catcher) · [listmonk] · web (/internal/revalidate)
```

## Run
```bash
docker compose up --build                      # first start installs dependencies, migrates and seeds (a few minutes)
docker compose --profile newsletters up --build   # + listmonk and its database
docker compose logs -f api                     # follow one service
docker compose down                            # stop (keep data)   |   docker compose down -v   # stop and delete all data
```

| URL | What |
| --- | --- |
| http://localhost:3000 | public site |
| http://localhost:3000/admin | admin (`admin@example.com` / `admin-password-123`, seeded; `reader@example.com` / `reader-password-123` for the reader flow) |
| http://localhost:3000/api/health | API health (`/api/v1/openapi.json` for the external API) |
| http://localhost:8025 | Mailpit inbox: verification, password-reset and newsletter-confirmation emails |
| http://localhost:9000 | listmonk (profile `newsletters`; `admin` / `listmonk-admin`) |
| localhost:5432 | Postgres `blog` / `blog` / `blog` (and `blog_test` for the API test suite) |

## How it works
* **Hot reload**: the repo is bind-mounted into the containers (`.:/app`); `pnpm dev` runs in each (`tsx watch` for the API, `next dev` for web and admin). Dependencies and `.next` live in named volumes, so host `node_modules` are never used.
* **`setup` service** (one-shot, runs before the apps): `pnpm install --frozen-lockfile`, `pnpm db:migrate`, `pnpm db:seed` (skip seeding with `SEED_DB=0`). After changing dependencies just run `docker compose up` again (or `docker compose run --rm setup`).
* **Email**: `MAILER_DRIVER=smtp` to Mailpit. Sign up on the site, open Mailpit, click the verification link. (Accounts listed in `ADMIN_EMAILS`, default `admin@example.com`, become admins once verified.)
* **Uploads**: stored in the `uploads` volume, served by the API at `/api/media/files/*`.
* **Config**: override anything in a root `.env` (compose reads it automatically): `PORT` (public port, then also set `PUBLIC_URL`), `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `ADMIN_EMAILS`, `EMBEDDING_API_KEY` (enables semantic search/related posts), `GOOGLE_*`/`GITHUB_*`, `LISTMONK_*`, `LOG_LEVEL`, `WATCHPACK_POLLING=true` (if file watching is slow on macOS/Windows bind mounts).
* Everything here is **development only**: the default secrets/passwords are public.

## Newsletters (listmonk)
1. `docker compose --profile newsletters up -d`, open http://localhost:9000 and follow `docs/NEWSLETTERS.md` §2 to create an API user and token.
2. In listmonk **Settings → SMTP** use host `mailpit`, port `1025`, auth `none`, so campaign emails also land in Mailpit.
3. Put `LISTMONK_URL=http://listmonk:9000`, `LISTMONK_USER`, `LISTMONK_API_TOKEN` (and optionally `LISTMONK_LIST_ID`) into the root `.env` and `docker compose up -d api`.
Without `LISTMONK_URL` the API uses a no-op provider (the admin UI shows a warning instead of sending).

## Troubleshooting
* *Port 3000 in use*: set `PORT=3100` and `PUBLIC_URL=http://localhost:3100` in `.env`.
* *Stale dependencies / odd build errors*: `docker compose down -v && docker compose up --build` (recreates the node_modules/.next volumes and the database).
* *Running the checks inside the stack*: `docker compose run --rm api pnpm test` (API tests use the `blog_test` database on `db`; set `TEST_DATABASE_URL=postgres://blog:blog@db:5432/blog_test`).
* The stack uses `next dev`, so the first request to each page compiles it (slower than production). Performance numbers (Lighthouse) must be measured on a production build.
