import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";
import { apiJson, BASE, gotoThemed, test } from "./helpers";

const MODES = ["light", "dark"] as const;
const STATIC_PAGES = ["/", "/posts", "/posts/new", "/media", "/comments", "/comments?tab=reported", "/users", "/subscribers", "/newsletters", "/api-keys", "/settings"];

async function settle(page: Page) {
  // wait for skeletons / busy regions to disappear
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

async function scan(page: Page) {
  // The Lexical editor package's own widgets (toolbar font-size input, typeahead popovers, placeholder colours) have
  // known a11y gaps we are not allowed to patch (SPEC §1.8); everything around it is scanned.
  const results = await new AxeBuilder({ page }).exclude(".editor-shell").exclude("[aria-label='Typeahead menu']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, summary.join("\n")).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page-level horizontal scroll").toBeLessThanOrEqual(0);
}

test.describe("axe scans", () => {
  for (const mode of MODES) {
    for (const path of STATIC_PAGES) {
      test(`${path} (${mode})`, async ({ page }) => {
        await gotoThemed(page, path, mode);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path !== "/posts/new") await settle(page);
        else await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
        expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(mode === "dark");
        await scan(page);
      });
    }

    test(`post editor + newsletter editor (${mode})`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto(`${BASE}/`);
      const posts = await apiJson<{ id: string }[]>(page, "GET", "/admin/posts?pageSize=1");
      await gotoThemed(page, `/posts/${posts[0]!.id}`, mode);
      await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
      await scan(page);
      const nl = await apiJson<{ id: string }>(page, "POST", "/admin/newsletters", { subject: `a11y ${mode} ${Date.now()}` });
      try {
        await gotoThemed(page, `/newsletters/${nl.id}`, mode);
        await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
        await scan(page);
        await page.getByRole("tab", { name: "Preview" }).click();
        await expect(page.locator("iframe[title='Newsletter preview']")).toBeVisible({ timeout: 15_000 });
        await scan(page);
        await page.getByRole("tab", { name: "Send & stats" }).click();
        await scan(page);
      } finally {
        await apiJson(page, "DELETE", `/admin/newsletters/${nl.id}`);
      }
    });

    test(`dialogs and menus (${mode})`, async ({ page }) => {
      await gotoThemed(page, "/posts", mode);
      await settle(page);
      await page.getByRole("button", { name: /Account menu/ }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await scan(page);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Theme" }).click();
      await scan(page);
      await page.keyboard.press("Escape");
      await gotoThemed(page, "/api-keys", mode);
      await page.getByRole("button", { name: "Create key" }).click();
      await expect(page.getByRole("dialog", { name: "Create API key" })).toBeVisible();
      await scan(page);
    });
  }

  base("login page (light + dark, unauthenticated)", async ({ browser, baseURL }) => {
    for (const mode of MODES) {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      await gotoThemed(page, "/login", mode);
      await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
      await scan(page);
      await ctx.close();
    }
  });
});

test.describe("360px layout", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const path of STATIC_PAGES) {
    test(`${path} has no page-level horizontal scroll`, async ({ page }) => {
      await gotoThemed(page, path, "light");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path === "/posts/new") await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
      else await settle(page);
      await noHorizontalScroll(page);
      await scan(page);
    });
  }

  test("mobile navigation drawer opens, traps focus and closes with Escape", async ({ page }) => {
    await gotoThemed(page, "/", "light");
    const open = page.getByRole("button", { name: "Open navigation menu" });
    await open.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Posts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await dialog.getByRole("link", { name: "Media" }).click();
    await expect(page).toHaveURL(`${BASE}/media`);
    await expect(dialog).toBeHidden();
  });
});
