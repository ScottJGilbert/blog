import { expect, test as base } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE, READER_EMAIL, READER_PASSWORD } from "./helpers";

// Anonymous context for every test in this file.
const test = base;
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("route protection", () => {
  for (const path of ["/", "/posts", "/posts/new", "/media", "/comments", "/users", "/subscribers", "/newsletters", "/api-keys", "/settings"]) {
    test(`anonymous ${path} redirects to login with next`, async ({ page }) => {
      await page.goto(`${BASE}${path}`);
      await expect(page).toHaveURL(new RegExp(`${BASE}/login`));
      if (path !== "/") expect(new URL(page.url()).searchParams.get("next")).toBe(path);
      await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    });
  }

  test("a stale/invalid session cookie is rejected by the server-side check", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "blog.session_token", value: "garbage.value", url: baseURL! }]);
    await page.goto(`${BASE}/posts`);
    await expect(page).toHaveURL(new RegExp(`${BASE}/login\\?next=%2Fposts`));
  });

  test("the API enforces authorisation on its own", async ({ request }) => {
    expect((await request.get("/api/admin/stats")).status()).toBe(401);
  });
});

test.describe("login", () => {
  test("shows validation errors inline", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page.getByLabel(/^Email/)).toHaveAttribute("aria-invalid", "true");
  });

  test("wrong password shows a clear error", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/^Email/).fill(ADMIN_EMAIL);
    await page.getByLabel(/^Password/).fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password" })).toBeVisible();
  });

  test("admin signs in, lands on the dashboard, and signs out", async ({ page }) => {
    await page.goto(`${BASE}/login?next=/posts`);
    await page.getByLabel(/^Email/).fill(ADMIN_EMAIL);
    await page.getByLabel(/^Password/).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${BASE}/posts`);
    await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
    // login page redirects an authenticated admin away
    await page.goto(`${BASE}/login`);
    await expect(page).toHaveURL(`${BASE}`);
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/login`));
    await page.goto(`${BASE}/posts`);
    await expect(page).toHaveURL(new RegExp(`${BASE}/login`));
  });

  for (const evil of ["https://evil.example/", "//evil.example/", "/\\evil.example", "javascript:alert(1)"]) {
    test(`ignores unsafe next=${evil}`, async ({ page }) => {
      await page.goto(`${BASE}/login?next=${encodeURIComponent(evil)}`);
      await page.getByLabel(/^Email/).fill(ADMIN_EMAIL);
      await page.getByLabel(/^Password/).fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(`${BASE}`);
      expect(new URL(page.url()).hostname).not.toContain("evil");
    });
  }

  test("a signed-in reader sees the not-authorised screen with sign-out", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/^Email/).fill(READER_EMAIL);
    await page.getByLabel(/^Password/).fill(READER_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Not authorised" })).toBeVisible();
    // protected pages bounce back to the same screen
    await page.goto(`${BASE}/users`);
    await expect(page.getByRole("heading", { name: "Not authorised" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });
});
