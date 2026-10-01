import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ENGINEERING_SLUG, gotoThemed, PERSONAL_SLUG, READER, scrollToComments, signIn, THEME_KEY } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const MODES = ["light", "dark"] as const;

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

// Pages not covered by e2e/ui (they need a token / outcome query); the three themes are
// home (/reset-password, /newsletter/*), personal and engineering (posts, with comments loaded).
const STATIC = [
  "/reset-password?token=abcdefghijklmnop",
  "/reset-password",
  "/verify-email?verified=1",
  "/verify-email?error=invalid_token",
  "/newsletter/confirm?token=invalid-token-value",
  "/newsletter/unsubscribe?token=invalid-token-value",
  "/search?tag=postgres",
  "/search?q=zzzzqqqq",
  "/personal?tag=life",
  "/engineering?tag=does-not-exist",
];

for (const mode of MODES) {
  test.describe(`axe (${mode})`, () => {
    for (const path of STATIC) {
      test(path, async ({ page }) => {
        await gotoThemed(page, path, mode);
        await expectNoViolations(page);
      });
    }

    for (const path of [`/personal/${PERSONAL_SLUG}`, `/engineering/${ENGINEERING_SLUG}`]) {
      test(`${path} with comments loaded`, async ({ page }) => {
        await gotoThemed(page, path, mode);
        await scrollToComments(page);
        await expect(page.locator("#comments").getByRole("article").first()).toBeVisible().catch(() => undefined);
        await expect(page.locator("#comments [role=status][aria-label='Loading comments']")).toHaveCount(0);
        await expectNoViolations(page);
      });
    }

    test("signed in: account page, comment form, report dialog", async ({ page }) => {
      await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, mode]);
      await signIn(page, READER.email, READER.password, "/account");
      await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole("button", { name: "Delete my account…" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoViolations(page);
      await page.keyboard.press("Escape");

      await page.goto(`/personal/${PERSONAL_SLUG}`);
      const section = page.locator("#comments");
      await scrollToComments(page);
      await expect(section.getByLabel("Add a comment")).toBeVisible();
      await expectNoViolations(page);
    });

    test("mobile menu open at 360px", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await gotoThemed(page, "/personal", mode);
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expectNoViolations(page);
    });
  });
}
