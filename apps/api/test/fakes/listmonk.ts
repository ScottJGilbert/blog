/**
 * A fake listmonk HTTP server (real sockets, ephemeral port) implementing the subset of the API the app uses:
 * lists, subscribers (create/lookup/update/blocklist/delete), templates and campaigns (create/get/status/test).
 * Mirrors listmonk's behaviours that matter: `{ data }` envelopes, 409 for an existing e-mail, 403 for bad credentials,
 * test sends only to existing subscribers.
 *
 *   const lm = await startFakeListmonk({ user: "api", token: "secret" });
 *   new ListmonkProvider({ url: lm.url, user: "api", apiToken: "secret", listId: "1" }, logger);
 *   lm.requests / lm.campaigns / lm.subscribers   // inspect
 *   lm.failNext("POST /api/campaigns", 500, 2)    // inject failures
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeSubscriber {
  id: number;
  email: string;
  name: string;
  status: "enabled" | "blocklisted";
  attribs: Record<string, unknown>;
  lists: Array<{ id: number; name: string; subscription_status: string }>;
}
export interface FakeCampaign {
  id: number;
  name: string;
  subject: string;
  body: string;
  content_type: string;
  type: string;
  messenger: string;
  template_id: number | null;
  from_email?: string;
  status: "draft" | "running" | "finished";
  lists: Array<{ id: number }>;
  to_send: number;
  sent: number;
  views: number;
  clicks: number;
  bounces: number;
}
export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: any;
  headers: IncomingMessage["headers"];
}
interface Failure {
  key: string;
  status: number;
  remaining: number;
  /** close the socket instead of answering */
  drop?: boolean;
}

export interface FakeListmonk {
  url: string;
  requests: FakeRequest[];
  lists: Array<{ id: number; name: string; type: string; optin: string }>;
  subscribers: FakeSubscriber[];
  templates: Array<{ id: number; name: string; type: string; body: string }>;
  campaigns: FakeCampaign[];
  tests: Array<{ campaignId: number; subscribers: string[]; body: any }>;
  /** the next `times` requests matching "METHOD /path" (e.g. "POST /api/campaigns") answer `status` (or drop the connection) */
  failNext(key: string, status: number, times?: number, opts?: { drop?: boolean }): void;
  /** requests whose "METHOD /path" starts with `prefix` */
  count(prefix: string): number;
  setCampaignStats(id: number, stats: Partial<Pick<FakeCampaign, "sent" | "to_send" | "views" | "clicks" | "bounces" | "status">>): void;
  close(): Promise<void>;
}

export interface FakeListmonkOptions {
  user?: string;
  token?: string;
  /** accepted scheme: token (default), basic or any */
  scheme?: "token" | "basic" | "any";
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function startFakeListmonk(options: FakeListmonkOptions = {}): Promise<FakeListmonk> {
  const user = options.user ?? "blog";
  const token = options.token ?? "test-token";
  const scheme = options.scheme ?? "token";
  const state: Omit<FakeListmonk, "url" | "failNext" | "count" | "setCampaignStats" | "close"> = {
    requests: [],
    lists: [],
    subscribers: [],
    templates: [],
    campaigns: [],
    tests: [],
  };
  const failures: Failure[] = [];
  let seq = { list: 0, sub: 0, tpl: 0, camp: 0 };

  const authorised = (header: string | undefined): boolean => {
    if (!header) return false;
    const tokenOk = header === `token ${user}:${token}`;
    const basicOk = header === `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
    return scheme === "token" ? tokenOk : scheme === "basic" ? basicOk : tokenOk || basicOk;
  };

  const listRef = (id: number) => {
    const l = state.lists.find((x) => x.id === id);
    return { id, name: l?.name ?? `list-${id}`, subscription_status: "confirmed" };
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://fake");
    const path = url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());
    const body = await readBody(req);
    state.requests.push({ method: req.method ?? "GET", path, query, body, headers: req.headers });
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const data = (payload: unknown, status = 200) => send(status, { data: payload });
    const error = (status: number, message: string) => send(status, { message });

    if (!authorised(req.headers.authorization)) return error(403, "invalid API credentials");

    const key = `${req.method} ${path}`;
    const fail = failures.find((f) => f.remaining > 0 && key.startsWith(f.key));
    if (fail) {
      fail.remaining--;
      if (fail.drop) return void req.socket.destroy();
      return error(fail.status, "injected failure");
    }

    const m = (re: RegExp) => re.exec(path);
    let g: RegExpExecArray | null;

    // ----- lists
    if (key === "GET /api/lists") {
      const results = state.lists.filter((l) => !query.query || l.name.toLowerCase().includes(query.query.toLowerCase()));
      return data({ results, total: results.length, per_page: results.length, page: 1 });
    }
    if (key === "POST /api/lists") {
      const list = { id: ++seq.list, name: String(body?.name), type: String(body?.type ?? "private"), optin: String(body?.optin ?? "single") };
      state.lists.push(list);
      return data(list);
    }

    // ----- templates
    if (key === "GET /api/templates") return data(state.templates);
    if (key === "POST /api/templates") {
      const t = { id: ++seq.tpl, name: String(body?.name), type: String(body?.type), body: String(body?.body ?? "") };
      state.templates.push(t);
      return data(t);
    }

    // ----- subscribers
    if (key === "GET /api/subscribers") {
      const q = query.query ?? "";
      const em = /subscribers\.email\s*=\s*'((?:[^']|'')*)'/i.exec(q);
      const wanted = em ? em[1]!.replace(/''/g, "'").toLowerCase() : null;
      const results = state.subscribers.filter((s) => (wanted ? s.email.toLowerCase() === wanted : true));
      return data({ results, total: results.length, per_page: 5, page: 1 });
    }
    if (key === "POST /api/subscribers") {
      const email = String(body?.email ?? "").toLowerCase();
      if (!email) return error(400, "invalid email");
      if (state.subscribers.some((s) => s.email === email)) return error(409, "E-mail already exists.");
      const sub: FakeSubscriber = {
        id: ++seq.sub,
        email,
        name: String(body?.name ?? ""),
        status: body?.status === "blocklisted" ? "blocklisted" : "enabled",
        attribs: body?.attribs ?? {},
        lists: ((body?.lists as number[]) ?? []).map(listRef),
      };
      state.subscribers.push(sub);
      return data(sub);
    }
    if ((g = m(/^\/api\/subscribers\/(\d+)\/blocklist$/)) && req.method === "PUT") {
      const sub = state.subscribers.find((s) => s.id === Number(g![1]));
      if (!sub) return error(404, "Subscriber not found.");
      sub.status = "blocklisted";
      sub.lists = sub.lists.map((l) => ({ ...l, subscription_status: "unsubscribed" }));
      return data(true);
    }
    if ((g = m(/^\/api\/subscribers\/(\d+)$/))) {
      const sub = state.subscribers.find((s) => s.id === Number(g![1]));
      if (!sub) return error(404, "Subscriber not found.");
      if (req.method === "PUT") {
        sub.email = String(body?.email ?? sub.email).toLowerCase();
        sub.name = String(body?.name ?? sub.name);
        sub.status = body?.status === "blocklisted" ? "blocklisted" : "enabled";
        sub.attribs = body?.attribs ?? sub.attribs;
        sub.lists = ((body?.lists as number[]) ?? []).map(listRef);
        return data(sub);
      }
      if (req.method === "DELETE") {
        state.subscribers = state.subscribers.filter((s) => s !== sub);
        return data(true);
      }
      if (req.method === "GET") return data(sub);
    }

    // ----- campaigns
    if (key === "POST /api/campaigns") {
      if (!body?.subject || !Array.isArray(body?.lists) || body.lists.length === 0) return error(400, "invalid campaign");
      const c: FakeCampaign = {
        id: ++seq.camp,
        name: String(body.name),
        subject: String(body.subject),
        body: String(body.body ?? ""),
        content_type: String(body.content_type ?? "richtext"),
        type: String(body.type ?? "regular"),
        messenger: String(body.messenger ?? "email"),
        template_id: typeof body.template_id === "number" ? body.template_id : null,
        from_email: body.from_email,
        status: "draft",
        lists: (body.lists as number[]).map((id) => ({ id })),
        to_send: 0,
        sent: 0,
        views: 0,
        clicks: 0,
        bounces: 0,
      };
      state.campaigns.push(c);
      return data(c);
    }
    if ((g = m(/^\/api\/campaigns\/(\d+)\/status$/)) && req.method === "PUT") {
      const c = state.campaigns.find((x) => x.id === Number(g![1]));
      if (!c) return error(404, "Campaign not found.");
      if (body?.status === "running") {
        c.status = "running";
        c.to_send = state.subscribers.filter((s) => s.status === "enabled" && s.lists.some((l) => c.lists.some((cl) => cl.id === l.id) && l.subscription_status !== "unsubscribed")).length;
      } else if (body?.status === "finished") c.status = "finished";
      else return error(400, "invalid status");
      return data(c);
    }
    if ((g = m(/^\/api\/campaigns\/(\d+)\/test$/)) && req.method === "POST") {
      const emails = ((body?.subscribers as string[]) ?? []).map((e) => e.toLowerCase());
      const known = emails.filter((e) => state.subscribers.some((s) => s.email === e));
      if (known.length === 0) return error(400, "No known subscribers to test with.");
      state.tests.push({ campaignId: Number(g[1]), subscribers: known, body });
      return data(true);
    }
    if ((g = m(/^\/api\/campaigns\/(\d+)$/)) && req.method === "GET") {
      const c = state.campaigns.find((x) => x.id === Number(g![1]));
      if (!c) return error(404, "Campaign not found.");
      return data(c);
    }

    return error(404, `fake listmonk: no route for ${key}`);
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: String(err) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    failNext(key: string, status: number, times = 1, opts: { drop?: boolean } = {}) {
      failures.push({ key, status, remaining: times, drop: opts.drop });
    },
    count(prefix: string) {
      return state.requests.filter((r) => `${r.method} ${r.path}`.startsWith(prefix)).length;
    },
    setCampaignStats(id: number, stats: Partial<FakeCampaign>) {
      const c = state.campaigns.find((x) => x.id === id);
      if (c) Object.assign(c, stats);
    },
    close() {
      return new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  }) as FakeListmonk;
}
