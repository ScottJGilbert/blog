import { expect, test, BASE, apiJson } from "./helpers";

test("create blank newsletter, edit with the editor, preview in a sandboxed iframe, test send, send now", async ({ page }) => {
  const subject = `E2E newsletter ${Date.now()}`;
  await page.goto(`${BASE}/newsletters`);
  await page.getByRole("button", { name: "New newsletter" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New newsletter" });
  await dlg.getByRole("button", { name: "Create and edit" }).click();
  await expect(dlg.getByText("Enter a subject line.")).toBeVisible();
  await dlg.getByLabel(/^Subject/).fill(subject);
  await dlg.getByRole("button", { name: "Create and edit" }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/newsletters/[0-9a-f-]{36}$`));
  const id = page.url().split("/").pop()!;

  try {
    const editable = page.locator(".editor-shell [contenteditable='true']").first();
    await expect(editable).toBeVisible({ timeout: 20_000 });
    await expect(editable).not.toContainText("Welcome");
    await page.getByLabel("Preheader").fill("Preview text");
    await editable.click();
    await page.keyboard.type("Hello subscribers from e2e");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Newsletter saved").first()).toBeVisible();

    // preview
    await page.getByRole("tab", { name: "Preview" }).click();
    const frame = page.locator("iframe[title='Newsletter preview']");
    await expect(frame).toBeVisible({ timeout: 15_000 });
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(frame).toHaveAttribute("srcdoc", /Hello subscribers from e2e/);
    const w = async () => (await frame.boundingBox())!.width;
    await page.getByRole("button", { name: /Mobile/ }).click();
    expect(Math.round(await w())).toBe(375);
    await page.getByRole("button", { name: /Tablet/ }).click();
    expect(Math.round(await w())).toBeGreaterThanOrEqual(700);
    await expect(page.frameLocator("iframe[title='Newsletter preview']").getByText("Hello subscribers from e2e")).toBeVisible();

    // test send + send now (provider may be the no-op: the warning is shown and nothing is marked sent)
    await page.getByRole("tab", { name: "Send & stats" }).click();
    await page.getByLabel("Test email address").fill("nobody@example.com");
    await page.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Test email sent|not configured|nothing|noop/i }).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Send now…" }).click();
    const confirm = page.getByRole("dialog", { name: "Send this newsletter now?" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/confirmed subscribers/)).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
  } finally {
    await apiJson(page, "DELETE", `/admin/newsletters/${id}`).catch(() => {});
  }
});

test("create from a post and list; schedule dialog", async ({ page }) => {
  await page.goto(`${BASE}/newsletters`);
  await page.getByRole("button", { name: "New newsletter" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New newsletter" });
  await dlg.getByLabel("An existing post").check();
  await dlg.getByLabel(/^Post/).selectOption({ index: 1 });
  await dlg.getByRole("button", { name: "Create and edit" }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/newsletters/[0-9a-f-]{36}$`));
  const id = page.url().split("/").pop()!;
  try {
    await expect(page.getByLabel("Use a post")).toBeChecked();
    await page.getByRole("tab", { name: "Send & stats" }).click();
    await page.getByRole("button", { name: "Schedule…" }).click();
    await expect(page.getByRole("dialog", { name: "Schedule newsletter" }).getByText(/Time zone:/)).toBeVisible();
  } finally {
    await apiJson(page, "DELETE", `/admin/newsletters/${id}`).catch(() => {});
  }
});

test("subscribers, api keys and settings pages", async ({ page }) => {
  await page.goto(`${BASE}/subscribers`);
  await expect(page.getByRole("heading", { level: 1, name: "Subscribers" })).toBeVisible();
  await page.getByRole("button", { name: "Sync with provider" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Synced|No newsletter provider/ }).first()).toBeVisible({ timeout: 15_000 });

  await page.goto(`${BASE}/api-keys`);
  await page.getByRole("button", { name: "Create key" }).click();
  const dlg = page.getByRole("dialog", { name: "Create API key" });
  await dlg.getByRole("button", { name: "Create key" }).click();
  await expect(dlg.getByText(/Give the key a name/)).toBeVisible();
  const name = `e2e key ${Date.now()}`;
  await dlg.getByLabel(/^Name/).fill(name);
  await dlg.getByRole("button", { name: "Create key" }).click();
  const reveal = page.getByRole("dialog", { name: "Copy your new API key" });
  await expect(reveal.getByText("only time the key is shown")).toBeVisible();
  const key = await reveal.getByLabel("New API key").inputValue();
  expect(key).toMatch(/^blg_/);
  await reveal.getByRole("button", { name: "I have saved the key" }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row.getByText(key.slice(0, 8))).toBeVisible();
  expect(await page.content()).not.toContain(key);
  await row.getByRole("button", { name: `Revoke ${name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke key" }).click();
  await expect(row.getByText("Revoked")).toBeVisible();

  await page.goto(`${BASE}/settings`);
  await expect(page.getByRole("heading", { level: 2, name: "Database" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Newsletter provider" })).toBeVisible();
});
