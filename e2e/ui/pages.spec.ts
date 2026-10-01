import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/personal", "/engineering", "/about", "/does-not-exist"];
const MODES = ["light", "dark"] as const;
const THEME_KEY = "blog-theme";

async function gotoThemed(page: Page, path: string, mode: "light" | "dark") {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [THEME_KEY, mode],
  );
  await page.goto(path, { waitUntil: "load" });
}

/** Observe layout shifts for the whole page lifecycle (incl. a scroll). */
async function measureCls(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[]) {
        if (!entry.hadRecentInput) {
          (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(800);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

for (const path of PAGES) {
  for (const mode of MODES) {
    test.describe(`${path} (${mode})`, () => {
      test("axe: no violations", async ({ page }) => {
        await gotoThemed(page, path, mode);
        const results = await new AxeBuilder({ page })
          .withTags([
            "wcag2a",
            "wcag2aa",
            "wcag21a",
            "wcag21aa",
            "wcag22aa",
            "best-practice",
          ])
          .analyze();
        expect(
          results.violations.map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
          ),
        ).toEqual([]);
      });

      test("landmarks: one main, one h1, banner, contentinfo", async ({
        page,
      }) => {
        await gotoThemed(page, path, mode);
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("header").first()).toBeVisible();
        await expect(page.locator("footer")).toHaveCount(1);
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
      });

      test("theme applied before paint (no wrong-theme flash)", async ({
        page,
      }) => {
        await gotoThemed(page, path, mode);
        const isDark = await page.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        );
        expect(isDark).toBe(mode === "dark");
      });

      test("no horizontal scroll at 320px, CLS ~ 0", async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await gotoThemed(page, path, mode);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        expect(await measureCls(page)).toBeLessThan(0.01);
      });
    });
  }
}

test("nav marks the active link with aria-current (including nested routes)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/engineering");
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Engineering" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Home" }),
  ).not.toHaveAttribute("aria-current", "page");
});

test("mobile menu is an accessible disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Menu" });
  const link = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Personal" });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(link).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(link).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
  await button.click();
  await link.click();
  await expect(page).toHaveURL(/\/personal$/);
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("touch targets are at least 44px on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  const targets = page.locator("header a, header button");
  for (const el of await targets.all()) {
    const box = await el.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
  }
});

test("theme toggle switches and persists without reload flash", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Dark mode" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("skip link moves focus to main", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});
