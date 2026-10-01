import { expect, test, BASE, ADMIN_EMAIL, READER_EMAIL, apiJson } from "./helpers";

test("search, ban with a reason, unban", async ({ page }) => {
  await page.goto(`${BASE}/users`);
  await page.getByRole("searchbox", { name: "Search users" }).fill("reader");
  const row = page.getByRole("row").filter({ hasText: READER_EMAIL });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: /Ban/ }).click();
  const dlg = page.getByRole("dialog", { name: /^Ban / });
  await dlg.getByRole("button", { name: "Ban user" }).click();
  await expect(dlg.getByText("Enter a reason")).toBeVisible();
  await dlg.getByLabel(/^Reason/).fill("e2e: spam");
  await dlg.getByRole("button", { name: "Ban user" }).click();
  await expect(row.getByText("Banned")).toBeVisible();
  await expect(row.getByText("Reason: e2e: spam")).toBeVisible();

  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Unban" }).click();
  await expect(row.getByText("Active")).toBeVisible();
});

test("guard rails: you cannot demote or delete yourself (API message is shown)", async ({ page }) => {
  await page.goto(`${BASE}/users`);
  await page.getByRole("searchbox", { name: "Search users" }).fill(ADMIN_EMAIL);
  const row = page.getByRole("row").filter({ hasText: ADMIN_EMAIL });
  await expect(row).toBeVisible();
  await expect(row.getByText("(you)")).toBeVisible();
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: /Make reader/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Make reader" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /yourself|last admin|cannot/i }).first()).toBeVisible();
  const me = await apiJson<{ role: string }>(page, "GET", "/me");
  expect(me.role).toBe("admin");
});

test("role filter", async ({ page }) => {
  await page.goto(`${BASE}/users`);
  await page.getByLabel("Role").selectOption("admin");
  await expect(page).toHaveURL(/role=admin/);
  await expect(page.getByRole("row").filter({ hasText: ADMIN_EMAIL })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: READER_EMAIL })).toHaveCount(0);
});
