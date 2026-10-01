# Blog platform

Full-stack blog: public site, admin, Express API, Postgres (pgvector), listmonk newsletters. pnpm monorepo, deployed to Vercel as one project with path-prefixed services.

| Path | What | Dev port |
| --- | --- | --- |
| `apps/web` | Public Next.js 16 site (Home / Personal / Engineering themes, search, auth, comments, newsletter) | 3000 |
| `apps/admin` | Admin Next.js app at `/admin` (posts + Lexical editor, media, users, moderation, newsletters, API keys) | 3001 |
| `apps/api` | Express 5 API at `/api` (Better Auth, posts, search, comments, admin, newsletters, external `/api/v1`) | 4000 |
| `packages/db` | Drizzle schema, migrations, seed | |
| `packages/shared` | zod DTOs + typed API client | |
| `packages/content` | Blog Content Format (BCF) standard + parser / validator / HTML renderer (`STANDARD.md`) | |

Docs: [`docs/SPEC.md`](docs/SPEC.md) (architecture + API contract), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/NEWSLETTERS.md`](docs/NEWSLETTERS.md), [`docs/STATUS.md`](docs/STATUS.md), [`docs/lighthouse/`](docs/lighthouse).

## Quick start (Docker, no Vercel needed)
```bash
docker compose up --build       # web + admin + api + Postgres(pgvector) + Mailpit behind a Caddy reverse proxy, hot reload
```
Open <http://localhost:3000> (site), <http://localhost:3000/admin> (admin; seeded `admin@example.com` / `admin-password-123`) and <http://localhost:8025> (Mailpit: all emails the API sends).
Add `--profile newsletters` for listmonk. Details, ports and troubleshooting: [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md).

## Quick start (without Docker)
```bash
cp .env.example .env            # edit secrets; needs a local Postgres with pgvector
pnpm install
pnpm db:migrate && pnpm db:seed # seed creates demo posts and (non-prod) admin@example.com / admin-password-123
pnpm dev                        # open http://localhost:3000 (web proxies /api and /admin like production)
```
Checks: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. E2E: see `playwright.config.ts` (projects `site`, `admin`; start the stack first).
> Next.js 16 differs from older versions: see `AGENTS.md`.
