# Blog Platform — Architecture & Contract Spec

Status: authoritative for the `full-application` branch. All agents/implementers build to this document.
Decisions below were confirmed with the owner (Scott) before implementation started.

## 1. Goals

Convert the single Next.js blog frontend into a full-stack platform:

| Piece | Tech | Path | Dev port | Prod route prefix |
| --- | --- | --- | --- | --- |
| Public site | Next.js 16 (App Router) | `apps/web` | 3000 | `/` |
| Admin | Next.js 16, `basePath: "/admin"` | `apps/admin` | 3001 | `/admin` |
| API | Express 5 + TypeScript | `apps/api` | 4000 | `/api` |
| DB | Postgres + pgvector (Neon in prod) | `packages/db` | 5432 | — |
| Newsletters | listmonk (container, external host) | `docker-compose.yml` | 9000 | not routed; API-only |
| Content standard | TypeScript lib + normative doc | `packages/content` | — | — |
| Shared DTOs/client | zod schemas + typed fetch client | `packages/shared` | — | — |

**Next.js 16 has breaking changes vs. older versions.** Before writing any Next code read the relevant guide in
`node_modules/next/dist/docs/` (see `AGENTS.md`). Do not rely on memory (e.g. `params` is a Promise, `middleware` is now
`proxy`, caching APIs changed, etc. — verify in the docs).

### Confirmed decisions

1. **Three themes = three site sections** (Home, Personal, Engineering). Each keeps a distinct visual identity and each
   supports light + dark. Shared: tokens for spacing/typography scale/radius/focus ring/motion, layout primitives, a11y behaviours.
2. **pnpm monorepo** in this repo. Deployed with **Vercel Services**: one project, one domain, path-prefixed services declared
   under `experimentalServices` in root `vercel.json` (web `/`, admin `/admin`, api `/api`). Framework preset must be "Services".
   (Listmonk runs in a container host, e.g. Railway/Fly/Render — outside Vercel; only the API talks to it.)
3. **Auth: Better Auth hosted in the Express API** (`/api/auth/*`), cookie sessions in Postgres, email+password, optional
   Google/GitHub OAuth (enabled only when env vars are set), email verification + password reset through a mailer interface.
   Roles: `reader` (default), `admin`. Same-origin everywhere (dev emulates prod via Next rewrites) so no CORS needed for the first-party apps.
4. **pgvector**: schema + HNSW index + pluggable embedding provider (OpenAI-compatible HTTP; disabled when `EMBEDDING_API_KEY` is unset).
   Hybrid search = Postgres full-text (always) fused with vector similarity (when embeddings exist). Related posts use vectors when available, otherwise tag/FTS overlap.
5. **Media**: Vercel Blob behind a `Storage` interface; local-disk driver for dev/test (`.data/uploads`, served by the API at `/api/media/files/*`).
6. **Transactional email**: `Mailer` interface; drivers: SMTP (nodemailer), Resend (HTTP), console (dev/test, default). Newsletters go through listmonk only.
7. **Priority order** if time runs short: UI polish → DB+API → web features → admin → newsletters. Unfinished pieces must be documented in `docs/STATUS.md`.
8. The `@scottjgilbert/lexical-blog-editor` npm package is used **as-is**. Do not modify or fork it; broken editor features are out of scope.
   Posts render on the public site **server-side from stored Lexical JSON via `@blog/content`** (zero client JS for content, for web-vitals), styled with the package's published CSS class names.

## 2. Repository layout

```
apps/web      apps/admin      apps/api
packages/db   packages/shared packages/content
docs/         vercel.json     docker-compose.yml     .env.example (per app too)
```

* Workspace packages export **TypeScript source** (`exports: ./src/index.ts`). Next apps set `transpilePackages: ["@blog/shared","@blog/content", ...]`.
  The API runs through `tsx` in dev/test and is bundled by `tsup` (inlining `@blog/*`) for production.
* Package names: `@blog/web`, `@blog/admin`, `@blog/api`, `@blog/db`, `@blog/shared`, `@blog/content`.
* Node 22, pnpm 11 (see root `packageManager`). ESM everywhere in packages/api.
* Tests: Vitest (db/shared/content/api), Playwright (e2e, root `e2e/`). API tests use a real Postgres at `TEST_DATABASE_URL`
  (default `postgres://blog:blog@localhost:5432/blog_test`, has `vector` extension available).

## 3. Environment variables

`DATABASE_URL` (default `postgres://blog:blog@localhost:5432/blog`), `TEST_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
(public origin, default `http://localhost:3000`), `SITE_URL` (default `http://localhost:3000`), `API_PORT=4000`,
`API_BASE_PATH=/api`, `API_INTERNAL_URL` (server-side URL web/admin use to reach the API; default `http://localhost:4000`),
`ADMIN_EMAILS` (comma list; accounts with these emails become `admin` on signup), `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`,
`MAILER_DRIVER=console|smtp|resend`, `SMTP_URL`, `RESEND_API_KEY`, `MAIL_FROM`,
`STORAGE_DRIVER=local|vercel-blob`, `BLOB_READ_WRITE_TOKEN`, `EMBEDDING_API_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` (default `text-embedding-3-small`),
`LISTMONK_URL`, `LISTMONK_USER`, `LISTMONK_API_TOKEN`, `LISTMONK_LIST_ID`, `LISTMONK_WEBHOOK_SECRET`,
`WEB_REVALIDATE_URL` (e.g. `http://localhost:3000/internal/revalidate`), `REVALIDATE_SECRET`, `CRON_SECRET`.
Every app ships an `.env.example`; nothing secret is committed. Missing optional integrations must degrade gracefully (feature disabled, clear log line), never crash.

### Dev topology (mirrors prod single-origin)
* `apps/web` next.config `rewrites()` (dev only, when `process.env.NODE_ENV !== "production"` or `DEV_PROXY=1`): `/api/:path*` → `API_INTERNAL_URL/api/:path*`, `/admin/:path*` → `http://localhost:3001/admin/:path*`.
* `apps/admin` has `basePath: "/admin"` and rewrites `/api/:path*` (with `basePath: false`) → API, so it also works standalone on :3001.
* Web and admin must **not** define routes under `/api` (owned by the API service). Web internal webhooks live under `/internal/*`.

## 4. Data model (`packages/db`, Drizzle ORM, SQL migrations committed under `packages/db/drizzle/`)

All ids are `uuid` (default `gen_random_uuid()`) except Better Auth tables (text ids as required by Better Auth). Timestamps are `timestamptz`.

* **Better Auth**: `user` (id, name, email unique, email_verified bool, image, `role` text default `reader` ('reader'|'admin'), `banned` bool default false, `ban_reason`, created_at, updated_at), `session`, `account`, `verification` (as generated by Better Auth for the Drizzle adapter; table names singular).
* `post`: id, `slug` unique, `title`, `excerpt`, `section` enum('personal','engineering'), `status` enum('draft','scheduled','published','archived'),
  `content` jsonb (Lexical SerializedEditorState, see §6), `content_text` text (plain text derived by `@blog/content`), `search_vector` tsvector generated (weights: title A, excerpt B, content_text C) with GIN index,
  `cover_image_url`, `cover_image_alt`, `author_id` → user, `published_at`, `scheduled_for`, `reading_minutes` int, `created_at`, `updated_at`.
* `tag` (id, slug unique, name), `post_tag` (post_id, tag_id, PK both).
* `post_embedding`: post_id PK→post (cascade), `model` text, `content_hash` text, `embedding vector(1536)`, `updated_at`; HNSW index `vector_cosine_ops`.
* `comment`: id, post_id, author_id → user, `parent_id` nullable → comment (**max depth 1**: replies to replies attach to the top-level parent), `body` text (plain text, ≤ 4000 chars), `status` enum('visible','hidden','deleted'), created_at, edited_at.
* `comment_report`: id, comment_id, reporter_id, reason, created_at, `resolved_at`. Unique (comment_id, reporter_id).
* `subscriber`: id, `email` unique (lowercased), `user_id` nullable → user, `status` enum('pending','confirmed','unsubscribed'), `confirm_token`, `unsubscribe_token` (unique, random), `listmonk_subscriber_id` int nullable, `source` text, created_at, confirmed_at, unsubscribed_at.
* `newsletter`: id, `subject`, `preheader`, `post_id` nullable, `content` jsonb nullable (Lexical state) , `html` text (rendered snapshot), `status` enum('draft','scheduled','sending','sent','failed'), `listmonk_campaign_id` int nullable, `scheduled_for`, `sent_at`, `stats` jsonb, `created_by` → user, created_at, updated_at.
* `media`: id, `key` unique (storage key), `url`, `mime`, `size_bytes`, `width`, `height`, `alt`, `uploaded_by`, created_at.
* `api_key`: id, `name`, `prefix` (first 8 chars, shown in UI), `key_hash` (sha256), `scopes` text[] (`posts:read`,`comments:read`,`tags:read`), `last_used_at`, `revoked_at`, `created_by`, created_at. Keys are shown once on creation, format `blg_<random>`.
* `audit_log`: id, actor_id, action, target_type, target_id, meta jsonb, created_at (admin mutations write here).

Seed script (`pnpm db:seed`): idempotent; creates tags, ~6 realistic published posts across both sections with valid Lexical JSON covering all node types in §6, plus (non-production only) an admin `admin@example.com / admin-password-123` and a reader `reader@example.com / reader-password-123` with a few comments.

## 5. HTTP API contract (`apps/api`)

Base path `/api` (configurable via `API_BASE_PATH`; the router must ALSO answer without the prefix because Vercel Services may strip the route prefix — mount at both `API_BASE_PATH` and `/`).
Content type JSON (`application/json`), except media upload (multipart) and `feed`/`health`. All responses:

```jsonc
// success
{ "data": <T>, "meta"?: { "page": 1, "pageSize": 10, "total": 42, "totalPages": 5 } }
// error (HTTP 4xx/5xx)
{ "error": { "code": "validation_error|unauthorized|forbidden|not_found|conflict|rate_limited|internal", "message": "...", "details"?: <zod issues> } }
```

Pagination: `?page=1&pageSize=10` (pageSize max 50, default 10). Dates are ISO strings. DTOs are defined once as zod schemas in `@blog/shared` and used by API validation, web, admin. The typed client in `@blog/shared/client` (`createApiClient({ baseUrl, fetch? })`) wraps every endpoint below.

Auth: Better Auth cookie session. `requireUser`, `requireAdmin` middleware. Banned users cannot sign in or post. CSRF: state-changing requests require `Origin` (or `Referer`) host to match `SITE_URL`/`BETTER_AUTH_URL`/trusted origins unless authenticated by API key.
Rate limits (express-rate-limit, in-memory is fine): auth endpoints 10/min/IP, comment create 10/min/user, subscribe 5/min/IP, public read 120/min/IP (higher with API key).

### 5.1 Auth & session
* `ALL /api/auth/*` → Better Auth handler (sign-up/email, sign-in/email, sign-out, get-session, forget/reset password, verify email, social).
* `GET /api/me` → `{ data: { id, name, email, image, role, emailVerified, subscription: { status } | null } }` (401 if signed out).
* `PATCH /api/me` `{ name?, image? }`. `DELETE /api/me` → anonymises account (comments body kept as "[deleted]" author "Deleted user").

### 5.2 Public content
* `GET /api/posts` query: `section?`, `tag?` (slug), `q?`, `page`, `pageSize`, `sort=newest|oldest` (default newest). Published only (`status=published AND published_at <= now()`). Item = `PostSummary` (no content): `{ id, slug, title, excerpt, section, tags[{slug,name}], coverImageUrl, coverImageAlt, author{ name, image }, publishedAt, readingMinutes }`.
* `GET /api/posts/:slug` → `PostDetail` = PostSummary + `content` (Lexical JSON), `contentHtml` (server-rendered by `@blog/content`), `toc[{id,text,level}]`, `updatedAt`, `prev/next` summaries (`{slug,title,section}`) within same section.
* `GET /api/posts/:slug/related?limit=3` → PostSummary[] (vector similarity if embeddings, else tag overlap, else newest in section).
* `GET /api/search?q=&section?&page&pageSize` → hybrid ranking; items = PostSummary + `snippet` (highlighted excerpt using `ts_headline`, `<mark>` tags only) + `score`. `q` min length 2.
* `GET /api/tags` → `[{slug,name,count}]` (published posts only).
* `GET /api/sitemap` → `[{ section, slug, updatedAt }]` for sitemap generation. `GET /api/feed.xml?section?` → RSS 2.0 (full HTML content, `application/rss+xml`).
* `GET /api/health` → `{ status:"ok", db:"up"|"down", version }` (no auth, no db failure leaks).

### 5.3 Comments
* `GET /api/posts/:slug/comments?page&pageSize` → top-level visible comments newest-first, each with `replies[]` (oldest-first, all visible replies), `author{name,image}`, `canEdit` when it's the viewer's. (`deleted` comments with replies appear as `{ body:"[deleted]" }`.)
* `POST /api/posts/:slug/comments` (auth, emailVerified required) `{ body, parentId? }` → 201 Comment. Body is plain text, trimmed, 1–4000 chars; links are not auto-linkified server-side.
* `PATCH /api/comments/:id` (author, within 15 minutes) `{ body }`. `DELETE /api/comments/:id` (author or admin; soft delete → `deleted`).
* `POST /api/comments/:id/report` (auth) `{ reason }` (reason 3–500 chars) → 204.

### 5.4 Newsletter (public)
* `POST /api/newsletter/subscribe` `{ email, source? }` → 202; creates/updates `subscriber` as `pending`, sends a confirmation email (double opt-in) with link `SITE_URL/newsletter/confirm?token=…`. Always 202 (no enumeration). Signed-in users with verified email may subscribe via `POST /api/me/subscription` (instantly `confirmed`).
* `POST /api/newsletter/confirm` `{ token }` → marks confirmed and upserts the subscriber into the listmonk list (when configured) → `{ data: { status: "confirmed" } }`.
* `POST /api/newsletter/unsubscribe` `{ token }` (also `GET /api/newsletter/unsubscribe?token=` for List-Unsubscribe one-click) → sets unsubscribed + blocklists/removes in listmonk.
* `GET /api/me/subscription`, `PUT /api/me/subscription` `{ subscribed: boolean }`, `DELETE`.
* `POST /api/webhooks/listmonk` (secret header `x-webhook-secret`) bounce/unsubscribe sync (best effort).

### 5.5 Admin (all require role `admin`; every mutation writes `audit_log`)
* **Posts**: `GET /api/admin/posts?status&section&q&page&pageSize` (includes drafts, no content), `GET /api/admin/posts/:id` (full), `POST /api/admin/posts`, `PATCH /api/admin/posts/:id`, `DELETE /api/admin/posts/:id`,
  `POST /api/admin/posts/:id/publish`, `/unpublish`, `/schedule {scheduledFor}`. Input: `{ title, slug?, excerpt?, section, tags: string[], content, coverImageUrl?, coverImageAlt?, status? }`. Server validates `content` against `@blog/content`, derives `content_text`, `reading_minutes`, auto-excerpt, unique slug, and (re)computes the embedding in the background (best effort) on publish/update. Publish/unpublish/delete trigger web revalidation (`WEB_REVALIDATE_URL`, tags `posts`, `post:<slug>`, `section:<section>`).
* **Media**: `POST /api/admin/media` (multipart `file`, `alt?`; images only: jpeg/png/webp/gif/avif ≤ 8 MB; magic-byte sniffing; random keys) → Media; `GET /api/admin/media?page`; `PATCH …/:id {alt}`; `DELETE …/:id`. Local driver files are served at `GET /api/media/files/:key`.
* **Users**: `GET /api/admin/users?q&role&page`, `GET /api/admin/users/:id`, `PATCH /api/admin/users/:id {role?}`, `POST …/:id/ban {reason}`, `POST …/:id/unban`, `DELETE …/:id`. Cannot demote/ban/delete yourself or the last admin.
* **Comments**: `GET /api/admin/comments?status&reported=true&page`, `PATCH /api/admin/comments/:id {status}`, `POST /api/admin/comments/:id/resolve-reports`.
* **Newsletters**: `GET /api/admin/newsletters`, `POST` (create draft, optionally from `postId`), `GET/PATCH/DELETE /:id`, `POST /:id/preview` → `{ html }`, `POST /:id/test {email}`, `POST /:id/send` (creates + starts listmonk campaign; idempotent per newsletter), `POST /:id/schedule {scheduledFor}`, `GET /:id/stats` (pulls campaign stats).
  `GET /api/admin/subscribers?status&q&page`, `DELETE /api/admin/subscribers/:id`, `POST /api/admin/subscribers/sync` (re-sync with listmonk).
* **API keys**: `GET/POST /api/admin/api-keys`, `DELETE /:id` (revoke).
* **Stats**: `GET /api/admin/stats` → `{ posts{published,draft,scheduled}, comments{total,reported}, users{total,admins}, subscribers{confirmed,pending}, recentPosts[], recentComments[] }`.
* `POST /api/admin/embeddings/reindex` → starts re-embedding all published posts (when provider configured).
* **Cron** (Vercel Cron, `Authorization: Bearer $CRON_SECRET`): `POST /api/cron/publish-scheduled` (flips due `scheduled` posts to `published`, revalidates web, sends due newsletters).

### 5.6 External public API (`/api/v1`)
Read-only, versioned, stable, CORS `*` (GET only), cacheable (`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, ETag), optional `Authorization: Bearer blg_…` or `x-api-key` for higher rate limit / future scoped data.
`GET /api/v1/posts` (same filters as §5.2), `GET /api/v1/posts/:slug` (includes `contentHtml` and Lexical `content`), `GET /api/v1/tags`, `GET /api/v1/search`, `GET /api/v1/comments?postSlug=` (visible comments, requires key scope `comments:read`), plus `GET /api/v1/openapi.json` (hand-maintained OpenAPI 3.1 document describing these).

### 5.7 Newsletter ↔ listmonk
* `ListmonkClient` (fetch based; base URL + API user/token; basic auth `user:token`): ensure list, upsert subscriber (`/api/subscribers`), set status, create campaign (`/api/campaigns`, content_type `html`, `template_id` optional), start (`PUT /api/campaigns/:id/status {status:"running"}`), campaign stats, transactional test via `POST /api/tx` or a one-off test campaign endpoint (`POST /api/campaigns/:id/test`).
* Interface `NewsletterProvider` (`upsertSubscriber`, `removeSubscriber`, `sendCampaign`, `testCampaign`, `campaignStats`) with `ListmonkProvider` and `NoopProvider` (used when `LISTMONK_URL` is unset: logs, marks sent=false with clear admin warning). All newsletter logic is tested against a fake listmonk HTTP server.
* `docker-compose.yml` runs `pgvector/pgvector:pg16` (app DB), `postgres` (listmonk DB) and `listmonk/listmonk`, with a documented `config.toml`/env block.

## 6. Content standard (`packages/content`)

`packages/content/STANDARD.md` is the normative **Blog Content Format (BCF) v1** document: storage format = Lexical `SerializedEditorState` JSON (Lexical 0.40, as produced by the editor package) wrapped as `{ "root": { ... } }`, stored in `post.content`. It lists every supported node `type` (derive the list from the editor package's `build/nodes`), its fields, required/optional attributes, allowed children, how each renders to HTML, plain text and RSS/email, and which are *email-safe* (fallbacks for newsletters), plus versioning/forward-compatibility rules (unknown nodes: preserved on storage, skipped with a warning when rendering, never crash).
Library API (`@blog/content`): `parseContent(json)` (zod-validated, tolerant), `validateContent`, `toPlainText`, `toExcerpt(content,len)`, `readingMinutes`, `extractToc` (headings with stable slug ids), `renderHtml(content, { target: "web" | "email" | "rss", baseUrl? })` (pure string renderer, no DOM, HTML-escaped, URL-scheme allowlist, iframe-host allowlist for YouTube/Figma/Twitter, class names compatible with `@scottjgilbert/lexical-blog-editor/styles/ViewerTheme.css`), `SUPPORTED_NODE_TYPES`, `emptyContent()`, `markdownToContent` helper for seeding. Heavily unit-tested with fixtures (including unknown nodes and malicious input).

## 7. Frontend requirements (apps/web)

**Performance targets**: Lighthouse (mobile + desktop) ≥ 95 for Performance, Accessibility, Best Practices, SEO on home, a listing page, a post page, search. LCP < 2.5 s, CLS < 0.05 (target 0), INP < 200 ms, TBT < 150 ms.
Rules: `next/font` (no CSS `@import` of Google Fonts, no icon-font CDN — Material Symbols are replaced by inline SVG icons / `react-icons` with tree-shaking), `font-display: swap` + size-adjust (next/font does this), explicit width/height/aspect-ratio for all media, no content injected above existing content after load, theme applied before first paint via an inline blocking script (no flash), fixed/sticky elements reserve space, `next/image` with proper `sizes` and priority for LCP image only, server components by default, client JS only for interactive islands, `loading="lazy"` for iframes/embeds, respect `prefers-reduced-motion`.
Accessibility (WCAG 2.2 AA): semantic landmarks, skip-to-content link, visible focus rings, 44×44 CSS px minimum touch targets (24 px absolute minimum), colour contrast ≥ 4.5:1 text / 3:1 UI in all three themes × light/dark, `aria-current` on nav, labelled form controls, announced errors (`aria-live`), keyboard operable menus (mobile nav as accessible disclosure), `lang`, one `h1` per page, descriptive link text, no `div` buttons, `aria-label`s on icon buttons, reduced-motion, 200% zoom and 320 px reflow without horizontal scroll.
Responsive: mobile (≥320), tablet (768), desktop (≥1024+) tested at 360×740, 768×1024, 1280×800, 1920×1080.

**Sections / theme identities**: Home = green "arboretum" editorial palette; Engineering = technical zinc/emerald, grid motif; Personal = warm editorial (warm paper tones, soft accent). **Typography is identical in all sections and modes (Epilogue display + Manrope body + system mono for code); only colours/motifs differ per theme**. Implement via a `data-section="home|personal|engineering"` attribute on the section wrapper + CSS variables (semantic tokens: `--bg --surface --text --muted --accent --border --ring`) layered on Tailwind v4 `@theme`, each with light and dark values. The navbar/footer adopt the current section's theme.

**Routes** (web): `/` home (hero, latest posts across sections, section cards, newsletter CTA), `/personal`, `/engineering` (paginated listings `?page=`, tag filter `?tag=`), `/personal/[slug]` & `/engineering/[slug]` (post page: header, cover, content from `contentHtml`, TOC on wide screens, tags, share link, related posts, prev/next, comments, newsletter box), `/search`, `/tags/[tag]`→ redirects to section-agnostic `/search?tag=`, `/about`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account`, `/newsletter/confirm`, `/newsletter/unsubscribe`, `/feed.xml`, `/sitemap.xml`, `/robots.txt`, `not-found`, `error`, `loading` skeletons with identical dimensions, `/internal/revalidate` (POST, secret-guarded). Data fetched in Server Components via the `@blog/shared/client` using `API_INTERNAL_URL`; use tag-based caching so admin publishes revalidate pages. Per-page metadata, canonical URLs, OpenGraph/Twitter, JSON-LD `BlogPosting`.

## 8. Admin requirements (apps/admin)

Distinct, neutral, dense "dashboard" UI (not the three site themes), light/dark, fully responsive, accessible. Pages: `/login` (admin role required, otherwise "not authorised"), `/` dashboard stats, `/posts` (table with filters, status badges, bulk-less simple actions), `/posts/new` & `/posts/[id]` (editor: title, slug, section, tags, excerpt, cover via media picker, Lexical `Editor` loaded with `next/dynamic` `ssr:false`, autosave draft, publish/unpublish/schedule, preview link, unsaved-changes guard), `/media` (grid, upload, alt text, delete), `/comments` (moderation queue, reports), `/users` (search, role, ban/unban, delete), `/subscribers`, `/newsletters` (list, compose from post or blank using editor, preview, test send, send/schedule, stats), `/api-keys`, `/settings` (read-only environment health: listmonk, mailer, storage, embeddings, db). Route protection through the Next 16 proxy convention (verify in docs) plus server-side session checks in layouts; the API is the real authority (role check on every route).

## 9. Security checklist
helmet, strict JSON body size (1 MB; media via multer limits), zod validation on all inputs, parameterised SQL only (Drizzle), output escaping in renderer, URL allowlists, no secrets in client bundles, cookies `HttpOnly; Secure (prod); SameSite=Lax`, constant-time compare for secrets/tokens, hashed API keys, login/sign-up rate limiting, enumeration-safe auth/newsletter responses, upload validation, audit log, banned-user session revocation, never log secrets or full emails at info level.

## 10. Definition of done
Everything builds (`pnpm build`), typechecks, lints; unit/integration tests pass (`pnpm test`); Playwright smoke e2e passes against locally running stack with seeded DB; Lighthouse targets met (or documented with reason); `docs/STATUS.md` lists completed/unfinished items and the manual steps (Vercel project setup, listmonk host, env vars).
