import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, isApiError } from "../src/client/index";

type Call = { url: string; init: RequestInit & { next?: unknown } };

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: (init ?? {}) as Call["init"] });
    return handler(url, init ?? {});
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const postSummary = {
  id: "6f1e8a1e-3a1f-4c5e-9d0b-1f2a3b4c5d6e",
  slug: "hello",
  title: "Hello",
  excerpt: "",
  section: "engineering",
  tags: [],
  coverImageUrl: null,
  coverImageAlt: null,
  author: { name: "A", image: null },
  publishedAt: "2026-01-01T00:00:00.000Z",
  readingMinutes: 1,
};

describe("createApiClient", () => {
  it("builds URLs from baseUrl + /api, serialises queries, unwraps data + meta", async () => {
    const { fn, calls } = mockFetch(() => json({ data: [postSummary], meta: { page: 2, pageSize: 5, total: 6, totalPages: 2 } }));
    const api = createApiClient({ baseUrl: "http://api.test/", fetch: fn });
    const res = await api.publicPosts({ section: "engineering", page: 2, pageSize: 5, tag: undefined, q: "" });
    expect(res.data).toHaveLength(1);
    expect(res.meta.totalPages).toBe(2);
    expect(calls[0]!.url).toBe("http://api.test/api/posts?section=engineering&page=2&pageSize=5");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("does not double the base path and supports relative (browser) base URLs", async () => {
    const { fn, calls } = mockFetch(() => json({ data: { status: "ok", db: "up", version: "1" } }));
    await createApiClient({ baseUrl: "http://x.test/api", fetch: fn }).health();
    await createApiClient({ baseUrl: "", fetch: fn }).health();
    await createApiClient({ baseUrl: "http://x.test", basePath: "/", fetch: fn }).health();
    expect(calls.map((c) => c.url)).toEqual(["http://x.test/api/health", "/api/health", "http://x.test/health"]);
  });

  it("passes requestInit through (including next.revalidate) and adds default cache tags", async () => {
    const { fn, calls } = mockFetch(() => json({ data: { ...postSummary, content: { root: { type: "root", children: [] } } } }));
    const api = createApiClient({ baseUrl: "http://x.test", fetch: fn });
    await api.post("hello world", { next: { revalidate: 300 }, headers: { "x-test": "1" } });
    expect(calls[0]!.url).toBe("http://x.test/api/posts/hello%20world");
    expect(calls[0]!.init.next).toEqual({ revalidate: 300, tags: ["posts", "post:hello world"] });
    expect(new Headers(calls[0]!.init.headers).get("x-test")).toBe("1");

    await api.post("a", { next: { tags: ["custom"] } });
    expect(calls[1]!.init.next).toEqual({ tags: ["custom"] });
    await api.me();
    expect("next" in calls[2]!.init).toBe(false);
  });

  it("sends JSON bodies, static + dynamic headers and the api key", async () => {
    const { fn, calls } = mockFetch(() => json({ data: { id: "i", body: "b" } }, 201));
    const api = createApiClient({
      baseUrl: "http://x.test",
      fetch: fn,
      apiKey: "blg_secret",
      headers: async () => ({ cookie: "a=b" }),
    });
    await api.createComment("slug", { body: "hi" }).catch(() => undefined);
    const h = new Headers(calls[0]!.init.headers);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe(JSON.stringify({ body: "hi" }));
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("cookie")).toBe("a=b");
    expect(h.get("x-api-key")).toBe("blg_secret");
  });

  it("throws a typed ApiError from the error envelope", async () => {
    const { fn } = mockFetch(() =>
      json({ error: { code: "validation_error", message: "Invalid input", details: [{ path: ["body"] }] } }, 400, { "x-request-id": "req-1" }),
    );
    const api = createApiClient({ baseUrl: "http://x.test", fetch: fn });
    const err = await api.createComment("s", { body: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isApiError(err)).toBe(true);
    const e = err as ApiError;
    expect(e.status).toBe(400);
    expect(e.code).toBe("validation_error");
    expect(e.message).toBe("Invalid input");
    expect(e.details).toEqual([{ path: ["body"] }]);
    expect(e.requestId).toBe("req-1");
    expect(e.isValidation).toBe(true);
  });

  it("maps non-envelope failures (proxy HTML, empty body) to a status-derived code", async () => {
    const { fn } = mockFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const err = (await createApiClient({ baseUrl: "http://x.test", fetch: fn }).tags().catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.code).toBe("internal");
    const { fn: f404 } = mockFetch(() => new Response(null, { status: 404 }));
    const e404 = (await createApiClient({ baseUrl: "http://x.test", fetch: f404 }).post("x").catch((e: unknown) => e)) as ApiError;
    expect(e404.isNotFound).toBe(true);
    expect(e404.code).toBe("not_found");
  });

  it("wraps network failures", async () => {
    const { fn } = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = (await createApiClient({ baseUrl: "http://x.test", fetch: fn }).tags().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("network_error");
    expect(err.status).toBe(0);
  });

  it("times out", async () => {
    const { fn } = mockFetch(
      (_url, init) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(init.signal!.reason));
        }),
    );
    const err = (await createApiClient({ baseUrl: "http://x.test", fetch: fn, timeoutMs: 20 }).tags().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("timeout");
  });

  it("returns void on 204 and handles empty bodies", async () => {
    const { fn, calls } = mockFetch(() => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: "http://x.test", fetch: fn });
    await expect(api.deleteComment("c1")).resolves.toBeUndefined();
    await expect(api.reportComment("c1", { reason: "spam" })).resolves.toBeUndefined();
    await expect(api.admin.posts.remove("p1")).resolves.toBeUndefined();
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "DELETE http://x.test/api/comments/c1",
      "POST http://x.test/api/comments/c1/report",
      "DELETE http://x.test/api/admin/posts/p1",
    ]);
  });

  it("validates responses when asked", async () => {
    const { fn } = mockFetch(() => json({ data: [{ slug: "only" }], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }));
    const lax = createApiClient({ baseUrl: "http://x.test", fetch: fn });
    await expect(lax.publicPosts()).resolves.toBeTruthy();
    const strict = createApiClient({ baseUrl: "http://x.test", fetch: fn, validate: true });
    const err = (await strict.publicPosts().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("bad_response");
  });

  it("uploads media as multipart without a JSON content-type", async () => {
    const { fn, calls } = mockFetch(() => json({ data: { id: "6f1e8a1e-3a1f-4c5e-9d0b-1f2a3b4c5d6e" } }, 201));
    const api = createApiClient({ baseUrl: "http://x.test", fetch: fn });
    await api.admin.media.upload(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), { alt: "x", filename: "a.png" });
    expect(calls[0]!.init.body).toBeInstanceOf(FormData);
    expect(new Headers(calls[0]!.init.headers).get("content-type")).toBeNull();
    expect((calls[0]!.init.body as FormData).get("alt")).toBe("x");
  });

  it("covers the admin + v1 namespaces with the SPEC paths", async () => {
    const { fn, calls } = mockFetch(() => json({ data: {} }));
    const api = createApiClient({ baseUrl: "http://x.test", fetch: fn });
    await Promise.allSettled([
      api.admin.stats(),
      api.admin.posts.publish("p"),
      api.admin.posts.schedule("p", { scheduledFor: "2030-01-01T00:00:00Z" }),
      api.admin.users.ban("u", { reason: "r" }),
      api.admin.comments.resolveReports("c"),
      api.admin.newsletters.send("n"),
      api.admin.subscribers.sync(),
      api.admin.apiKeys.revoke("k"),
      api.admin.embeddings.reindex(),
      api.v1.comments({ postSlug: "x" }),
      api.v1.openapi(),
      api.newsletter.confirm("tokentoken"),
      api.subscription.set(true),
    ]);
    expect(calls.map((c) => `${c.init.method} ${c.url.replace("http://x.test", "")}`)).toEqual([
      "GET /api/admin/stats",
      "POST /api/admin/posts/p/publish",
      "POST /api/admin/posts/p/schedule",
      "POST /api/admin/users/u/ban",
      "POST /api/admin/comments/c/resolve-reports",
      "POST /api/admin/newsletters/n/send",
      "POST /api/admin/subscribers/sync",
      "DELETE /api/admin/api-keys/k",
      "POST /api/admin/embeddings/reindex",
      "GET /api/v1/comments?postSlug=x",
      "GET /api/v1/openapi.json",
      "POST /api/newsletter/confirm",
      "PUT /api/me/subscription",
    ]);
  });

  it("feedUrl", () => {
    const api = createApiClient({ baseUrl: "https://blog.test" });
    expect(api.feedUrl()).toBe("https://blog.test/api/feed.xml");
    expect(api.feedUrl("personal")).toBe("https://blog.test/api/feed.xml?section=personal");
  });
});
