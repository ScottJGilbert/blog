# Newsletters (listmonk)

Newsletters are delivered by [listmonk](https://listmonk.app) (a self-hosted container). **Only the API talks to it**; the web and
admin apps never see its URL or credentials. Without `LISTMONK_URL` the API runs a no-op provider: everything else keeps working and
the admin UI shows "not configured" warnings instead of pretending an issue was sent.

```
reader ──subscribe──▶ API (pending, confirmation mail)
reader ──confirm────▶ API (confirmed) ──upsert──▶ listmonk list
admin  ──send───────▶ API ──create+start campaign──▶ listmonk ──SMTP──▶ subscribers
listmonk ──webhook (bounce / unsubscribe)──▶ API /api/webhooks/listmonk
```

## 1. Run it locally

```bash
docker compose --profile newsletters up -d   # whole stack + listmonk-db + listmonk (see docs/LOCAL_DEV.md); add `db` only to start just the database
open http://localhost:9000      # admin / listmonk-admin  (set in docker-compose.yml, DEV ONLY)
```

`docker-compose.yml` starts `listmonk/listmonk:latest` with `./listmonk --install --idempotent --yes` (creates the schema on first start,
does nothing afterwards) against its own `postgres:16` (`listmonk-db`). Configuration is `docker/listmonk/config.toml`; every key can be
overridden with `LISTMONK_<section>__<key>` environment variables. The app database (`db`, `pgvector/pgvector:pg16`) is separate and gets
`blog` + `blog_test` databases and the `vector` extension from `docker/initdb/01-databases.sql`.

Mail: listmonk sends through SMTP. The compose stack already runs Mailpit (http://localhost:8025): set **Settings → SMTP** in listmonk to host `mailpit`, port `1025`, auth `none`.

## 2. Create the API user and token

listmonk API users authenticate with a token (listmonk ≥ 2.4):

1. In listmonk: **Admin → Users → New** (older versions: **Settings → API**).
2. Type **API**, username e.g. `blog`, give it a role that allows `lists:get_all`, `lists:manage_all`, `subscribers:get_all`,
   `subscribers:manage`, `campaigns:get_all`, `campaigns:manage_all`, `templates:get` and `templates:manage`.
3. Save and **copy the token now** – it is shown once.

The API sends `Authorization: token <user>:<token>`. HTTP basic auth with the same pair is also accepted by listmonk; set
`LISTMONK_AUTH_SCHEME=basic` if you sit behind something that rewrites the `token` scheme.

Create the mailing list (**Lists → New**, type *private*, opt-in *single* – double opt-in is handled by the blog, see below) and note its numeric
id. If you skip this the API finds or creates a list called **"Blog newsletter"** by itself.

## 3. Environment variables (`apps/api/.env`)

| Variable | Meaning |
| --- | --- |
| `LISTMONK_URL` | Base URL of listmonk, e.g. `http://localhost:9000` (no trailing path). Unset ⇒ no-op provider. |
| `LISTMONK_USER` | API user name. |
| `LISTMONK_API_TOKEN` | API token of that user. |
| `LISTMONK_LIST_ID` | Numeric id of the list subscribers are added to (optional, see above). |
| `LISTMONK_WEBHOOK_SECRET` | Shared secret for `POST /api/webhooks/listmonk` (header `x-webhook-secret`). |
| `LISTMONK_AUTH_SCHEME` | `token` (default) or `basic`. |
| `LISTMONK_TEMPLATE_ID` | Campaign template to use. Default: the API creates a pass-through template `blog-raw` (`{{ template "content" . }}`) so its complete HTML document is not wrapped a second time. |
| `LISTMONK_FROM_EMAIL` | `from_email` of campaigns, e.g. `Scott <news@example.com>` (default: the listmonk default). |
| `SITE_URL` | Base for absolute links/images inside the newsletter HTML. |
| `CRON_SECRET` | Needed for scheduled newsletters (see §6). |

`GET /api/admin/system` (admin settings page) shows `newsletter: { provider: "listmonk" | "noop", configured }`.

## 4. Double opt-in and sync

* `POST /api/newsletter/subscribe` stores a **pending** subscriber and mails a confirmation link (`SITE_URL/newsletter/confirm?token=…`).
  Nothing is sent to listmonk yet, so unconfirmed addresses never receive an issue.
* `POST /api/newsletter/confirm` marks the subscriber **confirmed** and upserts it into the listmonk list (`preconfirm_subscriptions: true`
  because the blog already did the opt-in). If the address already exists in listmonk (HTTP 409) it is looked up and updated: other lists
  and attributes are kept, a blocklisted address is re-enabled, and the list is added.
* Unsubscribing (link in the blog, or listmonk's own `{{ UnsubscribeURL }}` link in every issue) marks the subscriber **unsubscribed** and
  **blocklists** the address in listmonk. listmonk's own unsubscribe page reaches the blog through the webhook (§5).
* `POST /api/admin/subscribers/sync` (admin → Subscribers → *Sync*) reconciles both directions and is idempotent and batched:
  confirmed subscribers are upserted into the list (their listmonk id is stored); unsubscribed subscribers still known to listmonk are blocklisted
  (and their stored id cleared so the next run skips them). The response is `{ providerConfigured, synced, failed }`. Run it after importing
  subscribers, after pointing the app at a fresh listmonk, or whenever the two drift apart.
* Deleting a subscriber in the admin erases it in listmonk too (best effort; a failure is recorded in the audit log, the local row is still removed).

## 5. Webhook (bounces / unsubscribes)

listmonk → **Settings → Bounces → Webhook** (or a custom messenger/webhook) → `POST https://<site>/api/webhooks/listmonk` with header
`x-webhook-secret: <LISTMONK_WEBHOOK_SECRET>`. The handler lives in the public API (WP B1); it is best effort.

## 6. Sending, scheduling, statistics

Admin → Newsletters:

1. **Create** a draft: blank (Lexical editor) or from a post (`postId`: subject you type, preheader = excerpt, body = cover + title + post + "read on
   the website" link). The HTML snapshot (`@blog/content` *email* target, 600 px table layout, absolute URLs, footer with `{{ UnsubscribeURL }}`
   and `{{ MessageURL }}`) is regenerated on every save. Stray `{{` in your text is escaped so it cannot break listmonk's Go templates.
2. **Preview** (`POST /:id/preview`) – tags replaced by inert links.
3. **Test** (`POST /:id/test {email}`) – one copy to one address, 5 per minute per admin. listmonk only sends tests to *existing* subscribers, so the
   address is created in listmonk (without list membership) first.
4. **Send** (`POST /:id/send`) – `draft|scheduled|failed → sending → sent|failed`, idempotent: sending a `sent` newsletter returns it unchanged,
   a `sending` one answers 409, two concurrent calls create one campaign. The response is `{ newsletter, provider, warning }`:
   * `provider: "noop"` + warning → nothing delivered, status unchanged (configure listmonk first).
   * provider error → HTTP 200, `newsletter.status: "failed"`, `newsletter.stats.error` and `warning` explain; fix and send again. If the campaign
     was created but not started, the retry starts the *same* campaign (no duplicates).
5. **Schedule** (`POST /:id/schedule {scheduledFor}`, future date, requires a configured provider). `POST /:id/unschedule` returns it to draft.
   Scheduled issues are sent by the cron job below.
6. **Stats** (`GET /:id/stats`) pulls `sent / toSend / views / clicks / bounces` from listmonk and caches them in `newsletter.stats`
   (when listmonk is unreachable the cached values come back with `stale: true`).

### Cron

`POST|GET /api/cron/publish-scheduled` (`Authorization: Bearer $CRON_SECRET`) publishes due scheduled posts **and** sends due scheduled
newsletters; it is safe to call concurrently. On Vercel add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/publish-scheduled", "schedule": "* * * * *" }] }
```

(Vercel Hobby only allows daily schedules; use any external scheduler hitting the URL every minute otherwise.) Vercel sends the
`Authorization: Bearer` header automatically when the project env var `CRON_SECRET` is set. A newsletter stuck in `sending` for 30 minutes
(crashed run) is moved to `failed` by the next run so it can be re-sent.

## 7. Production hosting

* Run listmonk as a container on a host that is **not** Vercel (it is a long-running Go server): Railway, Fly.io, Render, a small VPS …
  Use the `listmonk/listmonk` image with its own Postgres (managed Postgres from the host, or Neon – a *separate* database from the blog).
  First deploy: command `./listmonk --install --idempotent --yes && ./listmonk`, then keep the normal start command.
* Configure through environment variables (`LISTMONK_app__address=0.0.0.0:9000`, `LISTMONK_db__host/port/user/password/database/ssl_mode`,
  `LISTMONK_ADMIN_USER`/`LISTMONK_ADMIN_PASSWORD` for the first admin). Put it behind HTTPS and set **Settings → General → Root URL** to its public URL
  (unsubscribe/tracking links are built from it).
* Restrict access: the admin UI and API are only needed by you and the blog API. Use a strong admin password, an API user with the minimal role
  (§2), and – where the host allows – private networking or an IP allow-list for the API port.
* **SMTP**: Settings → SMTP in listmonk. Use a transactional provider (SES, Postmark, Resend SMTP, Mailgun …), authenticate your sending domain (SPF, DKIM,
  DMARC) and set the from address (`LISTMONK_FROM_EMAIL` or the listmonk default). The blog's own transactional mail (verification, reset, double opt-in)
  uses the separate `MAILER_DRIVER` setting.
* Set on the Vercel project: `LISTMONK_URL` (public https URL), `LISTMONK_USER`, `LISTMONK_API_TOKEN`, `LISTMONK_LIST_ID`, `LISTMONK_WEBHOOK_SECRET`, `CRON_SECRET`.
* Backups: back up the listmonk database (subscriber lifecycle and campaign history live there; the blog's `subscriber` table is the source of truth
  for who has *consented*, which is why sync exists).

## 8. Testing

`apps/api/test/fakes/listmonk.ts` is an in-process fake of the listmonk endpoints used (lists, subscribers, templates, campaigns, tests) with failure
injection; `test/admin/listmonk-provider.test.ts` covers the provider (auth schemes, 409 handling, retries/back-off, timeouts) and
`test/admin/newsletters.test.ts` / `cron.test.ts` the admin routes and the scheduled sends against it. No real listmonk is needed to run the suite.
