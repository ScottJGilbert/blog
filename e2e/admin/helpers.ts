import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { expect, test as base, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Admin e2e support.
 *
 * Run against a real stack (see docs/SPEC.md §3):
 *   API_PORT=4104 BETTER_AUTH_URL=http://localhost:3104 SITE_URL=http://localhost:3104 pnpm --filter @blog/api dev
 *   API_INTERNAL_URL=http://localhost:4104 pnpm --filter @blog/admin build && \
 *   API_INTERNAL_URL=http://localhost:4104 pnpm --filter @blog/admin exec next start -p 3104
 *   ADMIN_BASE_URL=http://localhost:3104 pnpm exec playwright test --project=admin
 * (DB must be migrated + seeded: admin@example.com / admin-password-123, reader@example.com / reader-password-123.)
 */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin-password-123";
export const READER_EMAIL = "reader@example.com";
export const READER_PASSWORD = "reader-password-123";
export const BASE = "/admin";

type State = Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
let cached: State | undefined;
// Shared across workers / worker restarts: the auth endpoints are rate limited (10/min/IP), so sign in once per ~15 min.
const STATE_FILE = "test-results/.admin-storage-state.json";
function readState(): State | undefined {
  try {
    if (existsSync(STATE_FILE) && Date.now() - statSync(STATE_FILE).mtimeMs < 15 * 60_000) return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    /* sign in again */
  }
  return undefined;
}

/** Sign in through the API once per worker (auth endpoints are rate limited to 10/min/IP) and reuse the cookies. */
export const test = base.extend({
  storageState: async ({ browser, baseURL }, use) => {
    cached ??= readState();
    if (!cached) {
      const ctx = await browser.newContext({ baseURL });
      const res = await ctx.request.post("/api/auth/sign-in/email", {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: { origin: baseURL! },
      });
      expect(res.ok(), `admin sign-in failed: ${res.status()}`).toBeTruthy();
      cached = await ctx.storageState();
      mkdirSync("test-results", { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(cached));
      await ctx.close();
    }
    await use(cached);
  },
});
export { expect };

export const THEME_KEY = "blog-admin-theme";

export async function gotoThemed(page: Page, path: string, mode: "light" | "dark") {
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, mode]);
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
}

/** Authenticated API helper bound to the page's cookies (Origin header satisfies the API's CSRF check). */
export function api(page: Page): APIRequestContext {
  return page.context().request;
}
export async function apiJson<T = unknown>(page: Page, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, data?: unknown): Promise<T> {
  const origin = new URL(page.url() === "about:blank" ? (process.env.ADMIN_BASE_URL ?? "http://localhost:3104") : page.url()).origin;
  const res = await api(page).fetch(`/api${path}`, { method, data, headers: { origin } });
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${await res.text()}`);
  if (res.status() === 204) return undefined as T;
  return ((await res.json()) as { data: T }).data;
}

/** 1x1 PNG with a unique trailing comment so each upload is distinct. */
export function tinyPng(): Buffer {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(base64, "base64");
}
