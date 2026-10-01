import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * e2e/web runs against the REAL stack + seeded DB (`pnpm db:seed`):
 *   API   `API_PORT=4103 ... pnpm --filter @blog/api dev`  (RATE_LIMIT_ENABLED=0, MAILER_DRIVER=console)
 *   web   `next build && next start -p 3103`              (BASE_URL=http://localhost:3103)
 * Emails are read from the API's console-mailer output: set API_LOG_FILE to the file the API's stdout goes to.
 */
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
export const API_LOG_FILE = process.env.API_LOG_FILE;

export const READER = { email: "reader@example.com", password: "reader-password-123", name: "Demo Reader" };
export const PERSONAL_SLUG = "notes-from-a-slow-morning";
export const ENGINEERING_SLUG = "hybrid-search-fusing-full-text-and-vectors";

export const hasMailLog = () => Boolean(API_LOG_FILE);

/** Most recent console-mailer message sent to `to` that contains a link matching `pattern`. */
export async function mailLink(to: string, pattern: RegExp, timeoutMs = 10_000): Promise<string> {
  if (!API_LOG_FILE) throw new Error("API_LOG_FILE is not set");
  const deadline = Date.now() + timeoutMs;
  const masked = to.replace(/^(.).*(@.*)$/, "$1***$2");
  while (Date.now() < deadline) {
    const lines = readFileSync(API_LOG_FILE, "utf8").split("\n").reverse();
    for (const line of lines) {
      // The console mailer masks the recipient in its log line (`n***@example.com`): accept either form.
      if (!line.includes("mail:console") || !(line.includes(to) || line.includes(masked))) continue;
      try {
        const rec = JSON.parse(line) as { to?: string; msg?: string };
        if (rec.to?.toLowerCase() !== to.toLowerCase() && rec.to?.toLowerCase() !== masked.toLowerCase()) continue;
        const match = rec.msg?.match(/https?:\/\/[^\s"<>]+/g)?.find((u) => pattern.test(u));
        if (match) return match;
      } catch {
        /* partial line */
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No mail with a link ${pattern} for ${to} found in ${API_LOG_FILE}`);
}

export function uniqueEmail(prefix = "e2e") {
  return `${prefix}+${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
}

/** Sign in through the UI (the same path a reader takes). */
export async function signIn(page: Page, email: string, password: string, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("main").getByLabel("Email address").fill(email);
  await page.getByRole("main").getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Create + verify an account straight through the API (fast fixture; the UI flow has its own test). */
export async function createVerifiedUser(request: APIRequestContext, name = "E2E Tester") {
  const email = uniqueEmail();
  const password = "e2e-password-12345";
  const res = await request.post("/api/auth/sign-up/email", {
    data: { name, email, password, callbackURL: "/verify-email?verified=1" },
    headers: { origin: BASE_URL },
  });
  expect(res.ok()).toBeTruthy();
  const link = await mailLink(email, /verify-email\?token=/);
  await request.get(link, { maxRedirects: 0 }).catch(() => undefined);
  return { email, password, name };
}

export const THEME_KEY = "blog-theme";
export async function gotoThemed(page: Page, path: string, mode: "light" | "dark") {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, mode]);
  await page.goto(path, { waitUntil: "load" });
}

/** Scroll the comments section into view (the lazy island swaps the element, so don't hold a handle on it). */
export async function scrollToComments(page: Page) {
  await page.evaluate(() => document.getElementById("comments")?.scrollIntoView({ block: "start" }));
}
