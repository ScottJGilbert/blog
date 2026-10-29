import { describe, expect, it } from "vitest";
import {
  derivedPublicOrigin,
  INTERNAL_REQUEST_HEADER,
  normalizeServiceUrl,
  protectionBypassHeaders,
  resolveServiceUrl,
  serverApiOptions,
  vercelHost,
} from "../src/server/index";
import { createApiClient } from "../src/client/index";

describe("normalizeServiceUrl (Vercel Services binding values)", () => {
  it.each([
    ["https://api.internal", "https://api.internal"],
    ["https://api.internal/", "https://api.internal"],
    ["http://localhost:4000///", "http://localhost:4000"],
    ["https://svc.vercel.app/api", "https://svc.vercel.app/api"],
    ["https://svc.vercel.app/_svc/api/", "https://svc.vercel.app/_svc/api"],
    ["https://svc.vercel.app/api?x=1#y", "https://svc.vercel.app/api"],
    ["  https://api.internal  ", "https://api.internal"],
    ["api-service.internal:3001", "https://api-service.internal:3001"],
    ["localhost:4000", "http://localhost:4000"],
  ])("%s -> %s", (raw, want) => expect(normalizeServiceUrl(raw)).toBe(want));

  it.each(["", "   ", undefined, null, "ftp://x.test", "javascript:alert(1)", "http://"])("rejects %s", (raw) => expect(normalizeServiceUrl(raw as string)).toBeUndefined());
});

describe("resolveServiceUrl", () => {
  it("prefers the configured value, then this deployment's public URL on Vercel, then the local default", () => {
    expect(resolveServiceUrl("https://bound.internal/", { VERCEL: "1", VERCEL_URL: "d.vercel.app" }, "http://localhost:4000")).toEqual({ url: "https://bound.internal", source: "env" });
    expect(resolveServiceUrl(undefined, { VERCEL: "1", VERCEL_URL: "d.vercel.app" }, "http://localhost:4000")).toEqual({ url: "https://d.vercel.app", source: "deployment" });
    expect(resolveServiceUrl("", {}, "http://localhost:4000")).toEqual({ url: "http://localhost:4000", source: "default" });
    expect(resolveServiceUrl(undefined, { VERCEL_URL: "d.vercel.app" }, "http://localhost:4000").source).toBe("default"); // not on Vercel
  });
});

describe("protection bypass header", () => {
  const env = {
    VERCEL_AUTOMATION_BYPASS_SECRET: "sekret",
    VERCEL_URL: "blog-abc-team.vercel.app",
    VERCEL_BRANCH_URL: "blog-git-x-team.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "blog.example.org",
  };
  it("is attached for this project's own public hosts only", () => {
    for (const u of ["https://blog-abc-team.vercel.app/api", "https://blog-git-x-team.vercel.app", "https://blog.example.org/internal/revalidate"]) {
      expect(protectionBypassHeaders(u, env), u).toEqual({ "x-vercel-protection-bypass": "sekret" });
    }
    for (const u of ["https://other-project.vercel.app", "https://api.internal", "http://localhost:4000", "https://blog-abc-team.vercel.app.evil.com", "not a url"]) {
      expect(protectionBypassHeaders(u, env), u).toEqual({});
    }
  });
  it("needs the secret", () => {
    expect(protectionBypassHeaders("https://blog-abc-team.vercel.app", { ...env, VERCEL_AUTOMATION_BYPASS_SECRET: "" })).toEqual({});
  });
});

describe("derived public origin", () => {
  const o = { VERCEL: "1", VERCEL_URL: "d.vercel.app", VERCEL_BRANCH_URL: "b.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "blog.example.org" };
  it("production -> production domain; preview -> the deployment itself; off Vercel -> nothing", () => {
    expect(derivedPublicOrigin({ ...o, VERCEL_ENV: "production" })).toBe("https://blog.example.org");
    expect(derivedPublicOrigin({ ...o, VERCEL_ENV: "preview" })).toBe("https://d.vercel.app");
    expect(derivedPublicOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "blog.example.org" })).toBeUndefined();
    expect(vercelHost("https://x.vercel.app/")).toBe("x.vercel.app");
    expect(vercelHost("x.vercel.app/path")).toBeUndefined();
    expect(vercelHost("*.vercel.app")).toBeUndefined();
  });
});

describe("serverApiOptions + createApiClient", () => {
  it("builds `<base>/api/...` URLs for every binding shape and sends the marker + bypass headers", async () => {
    const urls: string[] = [];
    const headers: Headers[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      headers.push(new Headers(init.headers));
      return new Response(JSON.stringify({ data: [], meta: { page: 1, pageSize: 1, total: 0, totalPages: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    for (const bound of ["https://api.internal", "https://api.internal/", "https://api.internal/api", "https://api.internal/api/"]) {
      const o = serverApiOptions({ API_INTERNAL_URL: bound });
      const client = createApiClient({ baseUrl: o.baseUrl, basePath: o.basePath, headers: o.headers, timeoutMs: o.timeoutMs, fetch: fetchImpl });
      await client.tags();
    }
    expect(new Set(urls)).toEqual(new Set(["https://api.internal/api/tags"]));
    expect(headers[0]!.get(INTERNAL_REQUEST_HEADER)).toBe("1");
    expect(headers[0]!.get("x-vercel-protection-bypass")).toBeNull();

    const pub = serverApiOptions({ VERCEL: "1", VERCEL_URL: "d.vercel.app", VERCEL_AUTOMATION_BYPASS_SECRET: "s" });
    expect(pub).toMatchObject({ baseUrl: "https://d.vercel.app", source: "deployment" });
    expect(pub.headers["x-vercel-protection-bypass"]).toBe("s");
  });

  it("uses a short timeout during `next build`", () => {
    expect(serverApiOptions({ NEXT_PHASE: "phase-production-build" }).timeoutMs).toBe(2500);
    expect(serverApiOptions({}).timeoutMs).toBe(8000);
    expect(serverApiOptions({}, 3000).timeoutMs).toBe(3000);
  });
});
