# Implementation Plan

Work is split into work packages (WP) with disjoint file ownership so they can run in parallel in one working tree.
Agents do **not** run `git commit`; the lead commits after each stage. Dependencies are pre-declared in each `package.json`
(use `pnpm --filter <pkg> add` only for genuinely new ones; if pnpm fails on a lockfile race, retry).

## Stage A (parallel)
| WP | Owner dir | Summary |
| --- | --- | --- |
| A1 UI/UX | `apps/web` (existing pages/components only) | Visual/layout-shift/a11y/responsive/web-vitals cleanup, three section themes, shared tokens. Measured with Lighthouse + Playwright screenshots. |
| A2 Content | `packages/content` | BCF v1 standard doc + parser/validator/plain-text/TOC/HTML renderer, tests. |
| A3 Foundation | `packages/db`, `packages/shared`, `apps/api` skeleton | Full Drizzle schema + migrations + seed, all zod DTOs + typed client, Express app skeleton (middleware, error model, Better Auth, mailer, storage, newsletter-provider interfaces, route registry, test harness). |

## Stage B (parallel, after A2+A3; B3 also after A1)
| WP | Owner | Summary |
| --- | --- | --- |
| B1 API public | `apps/api/src/routes/public/**` (+ services it needs) | posts read, search (FTS+vector), tags, related, comments, newsletter public flows, `/me`, RSS/sitemap, embeddings service. |
| B2 API admin | `apps/api/src/routes/admin/**`, `routes/v1/**`, `routes/cron.ts`, `services/newsletter/**`, `services/media/**` | admin CRUD, media, users, moderation, newsletters+listmonk, api keys, v1 external API, cron. |
| B3 Web features | `apps/web` | all routes in SPEC §7 built on cleaned UI. |
| B4 Admin app | `apps/admin` | SPEC §8. |

## Stage C (lead)
Integration (run full stack, seed, e2e Playwright), Lighthouse audit/fixes, `vercel.json` (Services), `docker-compose.yml`, Dockerfile updates,
README + `docs/STATUS.md`, full code review pass, push.
