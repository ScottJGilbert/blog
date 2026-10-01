import { z } from "zod";
import type { PaginationMeta, Paginated } from "../schemas/common";
import { ErrorEnvelopeSchema } from "../schemas/common";
import { ApiError, codeForStatus } from "./errors";

/** Next.js `fetch` extension; ignored by browsers / plain fetch. */
export interface NextFetchOptions {
  revalidate?: number | false;
  tags?: string[];
}

/** Optional last argument of every client method. */
export type ApiRequestInit = Omit<RequestInit, "method" | "body" | "next"> & {
  next?: NextFetchOptions;
};

// Derived from the global fetch types so this compiles both with and without the DOM lib.
type HeadersInitLike = NonNullable<ConstructorParameters<typeof Headers>[0]>;
type RequestCredentialsLike = NonNullable<RequestInit["credentials"]>;
type BodyInitLike = NonNullable<RequestInit["body"]>;

export type HeadersSource = HeadersInitLike | (() => HeadersInitLike | Promise<HeadersInitLike>);

export interface ApiClientOptions {
  /** Origin of the API, e.g. `http://localhost:4000` (server) or `""` / `window.location.origin` (browser, same-origin). */
  baseUrl: string;
  /** Path prefix of the API on that origin. Default `/api`. Not appended twice if `baseUrl` already ends with it. */
  basePath?: string;
  /** Custom fetch (tests, instrumentation). Default: global fetch. */
  fetch?: typeof fetch;
  /** Extra headers on every request (object, or a function — e.g. to forward the incoming `cookie` in a Server Component). */
  headers?: HeadersSource;
  /** Sent as `x-api-key` (for `/v1`). */
  apiKey?: string;
  /** Default `"include"` in the browser (cookie session), unset on the server. */
  credentials?: RequestCredentialsLike;
  /** Parse every response with its zod schema and throw `ApiError("bad_response")` on mismatch. Default false. */
  validate?: boolean;
  /** Abort requests after this many ms (default 15000, 0 disables). */
  timeoutMs?: number;
}

export interface CallOptions {
  query?: object;
  body?: unknown;
  init?: ApiRequestInit;
  /** Default Next.js cache tags for this call (merged unless the caller supplies `init.next.tags`). */
  tags?: string[];
}

export type Envelope<T> = { data: T; meta?: PaginationMeta };

export function buildQuery(query: object | undefined): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export class HttpClient {
  readonly origin: string;
  readonly basePath: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly opts: ApiClientOptions;

  constructor(opts: ApiClientOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetch;
    const base = trimSlash(opts.baseUrl);
    const basePath = "/" + (opts.basePath ?? "/api").replace(/^\/+|\/+$/g, "");
    this.basePath = basePath === "/" ? "" : basePath;
    this.origin = this.basePath && base.endsWith(this.basePath) ? base.slice(0, -this.basePath.length) : base;
  }

  url(path: string, query?: object): string {
    return `${this.origin}${this.basePath}${path}${buildQuery(query)}`;
  }

  private async headers(extra: Headers): Promise<Headers> {
    const h = new Headers();
    const src = this.opts.headers;
    const resolved = typeof src === "function" ? await src() : src;
    if (resolved) new Headers(resolved).forEach((v, k) => h.set(k, v));
    if (this.opts.apiKey) h.set("x-api-key", this.opts.apiKey);
    extra.forEach((v, k) => h.set(k, v));
    return h;
  }

  private signal(user: AbortSignal | null | undefined): { signal?: AbortSignal; cleanup: () => void } {
    const timeoutMs = this.opts.timeoutMs ?? 15_000;
    if (!timeoutMs) return { signal: user ?? undefined, cleanup: () => {} };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
    const onAbort = () => ctrl.abort(user?.reason);
    if (user) {
      if (user.aborted) onAbort();
      else user.addEventListener("abort", onAbort, { once: true });
    }
    return {
      signal: ctrl.signal,
      cleanup: () => {
        clearTimeout(timer);
        user?.removeEventListener("abort", onAbort);
      },
    };
  }

  /** Perform a request and return the raw `{data, meta}` envelope (data is `undefined` for 204 / empty bodies). */
  async raw(method: string, path: string, o: CallOptions = {}, schema?: z.ZodType): Promise<Envelope<unknown>> {
    const init = o.init ?? {};
    const extra = new Headers();
    let body: BodyInitLike | undefined;
    if (o.body instanceof FormData || (typeof Blob !== "undefined" && o.body instanceof Blob)) {
      body = o.body as BodyInitLike;
    } else if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      extra.set("content-type", "application/json");
    }
    extra.set("accept", "application/json");

    const headers = await this.headers(extra);
    if (init.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));

    const next: NextFetchOptions | undefined =
      o.tags || init.next ? { ...init.next, tags: init.next?.tags ?? o.tags } : undefined;
    const { signal, cleanup } = this.signal(init.signal);
    const credentials = init.credentials ?? this.opts.credentials ?? (typeof (globalThis as { window?: unknown }).window !== "undefined" ? "include" : undefined);
    const f = this.fetchImpl ?? globalThis.fetch;

    let res: Response;
    try {
      res = await f(this.url(path, o.query), {
        ...init,
        method,
        headers,
        body,
        signal,
        ...(credentials ? { credentials } : {}),
        ...(next ? { next } : {}),
      } as RequestInit);
    } catch (err) {
      cleanup();
      const timedOut = (err as { name?: string })?.name === "TimeoutError" || signal?.reason?.name === "TimeoutError";
      if (timedOut) throw new ApiError({ status: 0, code: "timeout", message: "Request timed out", cause: err });
      if (init.signal?.aborted) throw err; // caller-initiated abort: surface untouched
      throw new ApiError({
        status: 0,
        code: "network_error",
        message: err instanceof Error ? err.message : "Network error",
        cause: err,
      });
    }

    try {
      const requestId = res.headers.get("x-request-id");
      if (!res.ok) throw await this.toError(res, requestId);
      if (res.status === 204) return { data: undefined };
      const text = await res.text();
      if (!text) return { data: undefined };
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new ApiError({ status: res.status, code: "bad_response", message: "Response was not valid JSON", requestId, cause: err });
      }
      const env = (json && typeof json === "object" && "data" in json ? json : { data: json }) as Envelope<unknown>;
      if (this.opts.validate && schema) {
        const parsed = schema.safeParse(env.data);
        if (!parsed.success) {
          throw new ApiError({
            status: res.status,
            code: "bad_response",
            message: `Response did not match the expected shape (${method} ${path})`,
            details: parsed.error.issues,
            requestId,
          });
        }
        return { data: parsed.data, ...(env.meta ? { meta: env.meta } : {}) };
      }
      return env;
    } finally {
      cleanup();
    }
  }

  private async toError(res: Response, requestId: string | null): Promise<ApiError> {
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    const env = ErrorEnvelopeSchema.safeParse(parsed);
    if (env.success) {
      const { code, message, details } = env.data.error;
      return new ApiError({ status: res.status, code, message, details, requestId });
    }
    return new ApiError({
      status: res.status,
      code: codeForStatus(res.status),
      message: res.statusText || `HTTP ${res.status}`,
      requestId,
    });
  }

  /** Request returning a single resource: resolves to `data`, typed by `schema`. */
  async data<S extends z.ZodType>(method: string, path: string, schema: S, o?: CallOptions): Promise<z.output<S>> {
    const env = await this.raw(method, path, o, schema);
    return env.data as z.output<S>;
  }

  /** Request returning a page: resolves to `{ data: T[], meta }`. */
  async page<S extends z.ZodType>(path: string, item: S, o?: CallOptions): Promise<Paginated<z.output<S>>> {
    const schema = z.array(item);
    const env = await this.raw("GET", path, o, schema);
    const data = (env.data ?? []) as z.output<S>[];
    return { data, meta: env.meta ?? { page: 1, pageSize: data.length, total: data.length, totalPages: 1 } };
  }

  /** Request with no response body (204) — or one we ignore. */
  async void(method: string, path: string, o?: CallOptions): Promise<void> {
    await this.raw(method, path, o);
  }
}
