import type { Logger } from "../../logger";
import type { CampaignStats, NewsletterProvider, TestCampaignInput } from "./provider";

/**
 * listmonk REST client + `NewsletterProvider` (https://listmonk.app/docs/apis/apis/).
 *
 * Authentication: listmonk API users authenticate with `Authorization: token <api_user>:<api_token>` (v2.4+).
 * `authScheme: "basic"` sends the same pair as HTTP basic auth instead (also accepted by listmonk).
 * Secrets are only ever placed in the request header; they are never logged and never part of an error message.
 */
export type ListmonkErrorKind = "http" | "network" | "timeout" | "config" | "protocol";

export class ListmonkError extends Error {
  readonly name = "ListmonkError";
  readonly kind: ListmonkErrorKind;
  /** HTTP status of the response (kind `http`). */
  readonly status?: number;
  /** Set when a campaign was created but starting it failed, so callers can retry `startCampaign` instead of duplicating it. */
  campaignId?: string;

  constructor(kind: ListmonkErrorKind, message: string, opts: { status?: number; cause?: unknown; campaignId?: string } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.kind = kind;
    this.status = opts.status;
    this.campaignId = opts.campaignId;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export interface ListmonkConfig {
  url?: string;
  user?: string;
  apiToken?: string;
  /** Numeric id of the list subscribers are added to. When unset the list named `listName` is found/created. */
  listId?: string | number;
}

export interface ListmonkOptions {
  authScheme?: "token" | "basic";
  /** Campaign template id. Default: a pass-through template ("blog-raw") is found/created automatically. */
  templateId?: number;
  /** Name of the list to find/create when no `listId` is configured. */
  listName?: string;
  /** `from_email` of campaigns (default: the listmonk default). */
  fromEmail?: string;
  timeoutMs?: number;
  /** extra attempts after the first one for retryable failures (default 2) */
  retries?: number;
  /** base back-off in ms, doubled per attempt with jitter (default 250) */
  backoffMs?: number;
}

const RAW_TEMPLATE_NAME = "blog-raw";
const RAW_TEMPLATE_BODY = '{{ template "content" . }}';
const DEFAULT_LIST_NAME = "Blog newsletter";

interface Envelope<T> {
  data: T;
}
interface LmSubscriber {
  id: number;
  email: string;
  name: string;
  status?: string;
  attribs?: Record<string, unknown>;
  lists?: Array<{ id: number }>;
}
interface LmCampaign {
  id: number;
  name?: string;
  subject?: string;
  body?: string;
  content_type?: string;
  template_id?: number;
  from_email?: string;
  status?: string;
  to_send?: number;
  sent?: number;
  views?: number;
  clicks?: number;
  bounces?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Errors raised before the request left the machine: safe to retry even a POST. */
function neverReachedServer(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

export class ListmonkProvider implements NewsletterProvider {
  readonly kind = "listmonk";
  private readonly base: string;
  private readonly authHeader: string;
  private readonly opts: Required<Pick<ListmonkOptions, "timeoutMs" | "retries" | "backoffMs" | "listName">> & ListmonkOptions;
  private listIdPromise?: Promise<number>;
  private templateIdPromise?: Promise<number | undefined>;

  constructor(
    private readonly config: ListmonkConfig,
    private readonly logger?: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
    options: ListmonkOptions = {},
  ) {
    if (!config.url) throw new ListmonkError("config", "LISTMONK_URL is not configured");
    this.base = config.url.replace(/\/+$/, "");
    const user = config.user ?? "";
    const token = config.apiToken ?? "";
    this.authHeader =
      options.authScheme === "basic" ? `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}` : `token ${user}:${token}`;
    if (!user || !token) logger?.warn("listmonk: LISTMONK_USER and LISTMONK_API_TOKEN should both be set (API user + token)");
    this.opts = { timeoutMs: 10_000, retries: 2, backoffMs: 250, listName: DEFAULT_LIST_NAME, ...options };
  }

  // ----- transport ----------------------------------------------------------------------------------------------
  private async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, o: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<T> {
    const qs = o.query ? `?${new URLSearchParams(Object.entries(o.query).map(([k, v]): [string, string] => [k, String(v)])).toString()}` : "";
    const url = `${this.base}${path}${qs}`;
    const attempts = this.opts.retries + 1;
    let lastError: ListmonkError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let retryable = false;
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: {
            authorization: this.authHeader,
            accept: "application/json",
            ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        const text = await res.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        if (res.ok) {
          this.logger?.debug({ method, path, status: res.status }, "listmonk request");
          return json as T;
        }
        const message = (json as { message?: unknown } | undefined)?.message;
        lastError = new ListmonkError("http", `listmonk ${method} ${path} failed with ${res.status}${typeof message === "string" ? `: ${message}` : ""}`, { status: res.status });
        // 5xx is retried for idempotent verbs; POST only for gateway-ish failures where the request was most likely not processed
        retryable = method === "POST" ? [502, 503, 504].includes(res.status) : res.status >= 500;
      } catch (err) {
        if (err instanceof ListmonkError) throw err;
        const timedOut = (err as { name?: string }).name === "TimeoutError" || (err as { name?: string }).name === "AbortError";
        lastError = new ListmonkError(timedOut ? "timeout" : "network", `listmonk ${method} ${path} ${timedOut ? "timed out" : "could not be reached"}`, { cause: err });
        retryable = method === "POST" ? !timedOut && neverReachedServer(err) : true;
      }
      if (!retryable || attempt === attempts) break;
      const delay = this.opts.backoffMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2);
      this.logger?.warn({ method, path, attempt, status: lastError?.status, kind: lastError?.kind }, "listmonk request failed, retrying");
      await sleep(delay);
    }
    throw lastError!;
  }

  private async data<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, o: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<T> {
    const env = await this.request<Envelope<T> | undefined>(method, path, o);
    if (!env || typeof env !== "object" || !("data" in env)) throw new ListmonkError("protocol", `listmonk ${method} ${path} returned an unexpected response`);
    return env.data;
  }

  // ----- lists / templates --------------------------------------------------------------------------------------
  /** Id of the list we manage: `LISTMONK_LIST_ID`, else the list called `listName` (created when missing). Cached. */
  ensureList(): Promise<number> {
    this.listIdPromise ??= this.resolveList().catch((err) => {
      this.listIdPromise = undefined; // do not cache failures
      throw err;
    });
    return this.listIdPromise;
  }

  private async resolveList(): Promise<number> {
    const configured = this.config.listId !== undefined ? Number(this.config.listId) : NaN;
    if (Number.isInteger(configured) && configured > 0) return configured;
    if (this.config.listId) this.logger?.warn("listmonk: LISTMONK_LIST_ID is not a numeric list id; looking the list up by name instead");
    const name = this.opts.listName;
    const found = await this.data<{ results: Array<{ id: number; name: string }> }>("GET", "/api/lists", { query: { query: name, per_page: "all" } });
    const match = found.results?.find((l) => l.name === name);
    if (match) return match.id;
    const created = await this.data<{ id: number }>("POST", "/api/lists", { body: { name, type: "private", optin: "single", tags: ["blog"] } });
    return created.id;
  }

  /** Pass-through campaign template (`{{ template "content" . }}`) so our complete HTML documents are not double-wrapped. */
  private ensureTemplate(): Promise<number | undefined> {
    if (this.opts.templateId) return Promise.resolve(this.opts.templateId);
    this.templateIdPromise ??= (async () => {
      try {
        const all = await this.data<Array<{ id: number; name: string }>>("GET", "/api/templates");
        const existing = Array.isArray(all) ? all.find((t) => t.name === RAW_TEMPLATE_NAME) : undefined;
        if (existing) return existing.id;
        const created = await this.data<{ id: number }>("POST", "/api/templates", { body: { name: RAW_TEMPLATE_NAME, type: "campaign", subject: "", body: RAW_TEMPLATE_BODY } });
        return created.id;
      } catch (err) {
        this.templateIdPromise = undefined;
        this.logger?.warn({ err: err instanceof Error ? err.message : String(err) }, "listmonk: could not prepare the pass-through template; using the default template");
        return undefined;
      }
    })();
    return this.templateIdPromise;
  }

  // ----- subscribers --------------------------------------------------------------------------------------------
  private async findByEmail(email: string): Promise<LmSubscriber | null> {
    const res = await this.data<{ results: LmSubscriber[] }>("GET", "/api/subscribers", {
      query: { query: `LOWER(subscribers.email) = ${sqlString(email.trim().toLowerCase())}`, per_page: 5 },
    });
    return res.results?.find((s) => s.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
  }

  private async resolveSubscriberId(idOrEmail: string): Promise<number | null> {
    if (/^\d+$/.test(idOrEmail)) return Number(idOrEmail);
    return (await this.findByEmail(idOrEmail))?.id ?? null;
  }

  async upsertSubscriber(email: string, name?: string): Promise<{ externalId: string }> {
    const listId = await this.ensureList();
    const displayName = name?.trim() || email.split("@")[0] || email;
    try {
      const created = await this.data<{ id: number }>("POST", "/api/subscribers", {
        body: { email, name: displayName, status: "enabled", lists: [listId], preconfirm_subscriptions: true },
      });
      return { externalId: String(created.id) };
    } catch (err) {
      if (!(err instanceof ListmonkError) || !err.isConflict) throw err;
    }
    // e-mail already exists (409): look it up and update it, keeping its other lists/attributes, re-enabling it if blocklisted
    const existing = await this.findByEmail(email);
    if (!existing) throw new ListmonkError("protocol", "listmonk reported the subscriber exists but it could not be found");
    const lists = [...new Set([...(existing.lists ?? []).map((l) => l.id), listId])];
    await this.data("PUT", `/api/subscribers/${existing.id}`, {
      body: { email: existing.email, name: existing.name?.trim() || displayName, status: "enabled", lists, attribs: existing.attribs ?? {}, preconfirm_subscriptions: true },
    });
    return { externalId: String(existing.id) };
  }

  /** Blocklist (so no further campaign reaches the address). Unknown subscribers are ignored. */
  async removeSubscriber(externalIdOrEmail: string): Promise<void> {
    const id = await this.resolveSubscriberId(externalIdOrEmail);
    if (id === null) return;
    try {
      await this.data("PUT", `/api/subscribers/${id}/blocklist`);
    } catch (err) {
      if (err instanceof ListmonkError && err.isNotFound) return;
      throw err;
    }
  }

  /** Hard delete (right to erasure). Unknown subscribers are ignored. */
  async deleteSubscriber(externalIdOrEmail: string): Promise<void> {
    const id = await this.resolveSubscriberId(externalIdOrEmail);
    if (id === null) return;
    try {
      await this.request("DELETE", `/api/subscribers/${id}`);
    } catch (err) {
      if (err instanceof ListmonkError && err.isNotFound) return;
      throw err;
    }
  }

  // ----- campaigns ----------------------------------------------------------------------------------------------
  private campaignPayload(input: { name: string; subject: string; html: string }, listId: number, templateId: number | undefined): Record<string, unknown> {
    return {
      name: input.name,
      subject: input.subject,
      lists: [listId],
      type: "regular",
      content_type: "html",
      body: input.html,
      messenger: "email",
      headers: [],
      tags: ["blog"],
      ...(this.opts.fromEmail ? { from_email: this.opts.fromEmail } : {}),
      ...(templateId ? { template_id: templateId } : {}),
    };
  }

  /** Create AND start a campaign. If only the start fails, the thrown error carries `campaignId`. */
  async sendCampaign(input: { subject: string; html: string; preheader?: string; name: string }): Promise<{ campaignId: string }> {
    const [listId, templateId] = await Promise.all([this.ensureList(), this.ensureTemplate()]);
    const created = await this.data<{ id: number }>("POST", "/api/campaigns", { body: this.campaignPayload(input, listId, templateId) });
    const campaignId = String(created.id);
    try {
      await this.startCampaign(campaignId);
    } catch (err) {
      if (err instanceof ListmonkError) err.campaignId = campaignId;
      throw err;
    }
    return { campaignId };
  }

  async startCampaign(campaignId: string): Promise<void> {
    await this.data("PUT", `/api/campaigns/${encodeURIComponent(campaignId)}/status`, { body: { status: "running" } });
  }

  async testCampaign(input: TestCampaignInput): Promise<void> {
    const [listId, templateId] = await Promise.all([this.ensureList(), this.ensureTemplate()]);
    // listmonk only sends tests to EXISTING subscribers: make sure the address exists (without any list membership)
    try {
      await this.data("POST", "/api/subscribers", { body: { email: input.to, name: input.to.split("@")[0] || input.to, status: "enabled", lists: [] } });
    } catch (err) {
      if (!(err instanceof ListmonkError) || !err.isConflict) throw err;
    }
    let payload: Record<string, unknown>;
    let id = 0;
    if (input.campaignId) {
      const c = await this.data<LmCampaign>("GET", `/api/campaigns/${encodeURIComponent(input.campaignId)}`);
      id = c.id;
      payload = this.campaignPayload({ name: c.name ?? "Test", subject: input.subject || c.subject || "Test", html: c.body ?? "" }, listId, c.template_id ?? templateId);
    } else {
      payload = this.campaignPayload({ name: `Test: ${input.subject}`.slice(0, 200), subject: input.subject, html: input.html ?? "" }, listId, templateId);
    }
    await this.data("POST", `/api/campaigns/${id}/test`, { body: { ...payload, subscribers: [input.to] } });
  }

  async campaignStats(campaignId: string): Promise<CampaignStats> {
    const c = await this.data<LmCampaign>("GET", `/api/campaigns/${encodeURIComponent(campaignId)}`);
    return {
      sent: c.sent ?? 0,
      toSend: c.to_send ?? 0,
      views: c.views ?? 0,
      clicks: c.clicks ?? 0,
      bounces: c.bounces ?? 0,
      status: c.status,
    };
  }
}
