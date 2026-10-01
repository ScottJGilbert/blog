# Status

## Done
- **UI/UX cleanup** of the public site: three section themes (Home / Personal / Engineering) × light/dark on shared tokens, fixed layout shifts (fonts via `next/font`, no icon font, theme set before paint, sticky header), mobile/tablet layout, WCAG 2.2 AA (axe-clean in Playwright), skip link, landmarks, reduced motion. Lighthouse: Accessibility / Best Practices / SEO 100, desktop Performance 100, CLS 0 (see `docs/lighthouse/`).
- **Monorepo + Vercel Services config** (`vercel.json`), pgvector schema/migrations/seed, Better Auth in Express, posts/search (FTS + vector hybrid, pluggable embeddings), comments, newsletter double opt-in + listmonk provider, media (Vercel Blob / local), API keys + external `/api/v1` + OpenAPI, cron for scheduled posts/newsletters.
- **Public web features**: listings with pagination/tags, post pages (server-rendered Lexical content via `@blog/content`, TOC, related, prev/next), search, auth pages, account, comments, newsletter pages, RSS, sitemap, robots, ISR with tag revalidation from the API.
- **Admin app**: posts + Lexical editor (autosave, publish/schedule), media, comments moderation, users, subscribers, newsletters, API keys, system settings.
- **Content standard** `packages/content/STANDARD.md` (BCF v1) with cross-platform parsing guide.
- Tests: ~750 unit/integration tests (real Postgres) + Playwright (site 177, admin 74). Security review pass applied (see commit history).

## Known gaps / caveats
- **Mobile Lighthouse Performance is 91–98** (not strictly >95 on every page every run): the simulated lab LCP (~2.3–3 s) is bounded by the Next/React runtime; real throttled-browser LCP is 0.7–1.2 s and CLS 0. Accessibility/Best Practices/SEO are 100.
- **Vercel Services is experimental**: not deployed from here; verify prefix handling (`/admin` basePath, `/api` prefix) and the "Services" framework preset in the dashboard (`docs/DEPLOYMENT.md`).
- **listmonk** was tested only against a fake server; `docker compose up` was not run (no Docker in the build sandbox). Run through `docs/NEWSLETTERS.md` once.
- The cron is daily (Vercel Hobby limit): scheduled posts publish at most daily unless you use Pro / an external scheduler.
- Old `Dockerfile` removed (it targeted the pre-monorepo layout); Vercel is the deployment target.
- Out of scope per request: changes to `@scottjgilbert/lexical-blog-editor` (used as-is). The package's `index.css` imports Google Fonts; admin strips that import at build (`apps/admin/build-tools/`) so the editor works offline/behind proxies. Editor dark mode follows the OS, not the admin toggle. Embedded editor images are `data:` URIs and are externalised to storage by the API on save (≈4 MB request limit).
- No in-admin preview for unpublished drafts; browser Back is not guarded by the unsaved-changes prompt.
- Residual risks listed by the security review: possible duplicate listmonk campaign if a serverless function dies mid-send; background embedding may be frozen after response on serverless (`waitUntil` not used); account deletion needs no password re-confirm.
- Embeddings are disabled until `EMBEDDING_API_KEY` is set (FTS-only search meanwhile).

## Manual steps to go live
1. Neon DB → `DATABASE_URL`, run `pnpm db:migrate`. 2. Vercel project (Framework: Services), env vars per `docs/DEPLOYMENT.md`. 3. Resend/SMTP + `MAIL_FROM`. 4. Vercel Blob token. 5. listmonk container host + API user. 6. Sign up with an `ADMIN_EMAILS` address, then verify email.
