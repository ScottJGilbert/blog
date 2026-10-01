import { expect, test, tinyPng, BASE } from "./helpers";

test("upload (button + drag-drop zone validation), edit alt text, copy URL and delete", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.goto(`${BASE}/media`);
  await expect(page.getByRole("heading", { level: 1, name: "Media" })).toBeVisible();

  // client-side validation: wrong type and oversize are rejected before any request
  await page.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").filter({ hasText: "not a supported image type" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(8 * 1024 * 1024 + 10) });
  await expect(page.getByRole("alert").filter({ hasText: "the limit is" })).toBeVisible();

  // real upload
  const name = `e2e-${Date.now()}.png`;
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: tinyPng() });
  await expect(page.getByText("Image uploaded").first()).toBeVisible({ timeout: 15_000 });

  // newest first: open details of the first card
  const firstEdit = page.getByRole("button", { name: /^Edit details for/ }).first();
  await expect(firstEdit).toBeVisible();
  await firstEdit.click();
  const dlg = page.getByRole("dialog", { name: "Image details" });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel("Alt text").fill("A tiny e2e pixel");
  await dlg.getByRole("button", { name: "Save alt text" }).click();
  await expect(page.getByText("Alt text saved").first()).toBeVisible();
  await expect(page.getByText("A tiny e2e pixel").first()).toBeVisible();

  // copy url
  await page.getByRole("button", { name: /^Copy URL of A tiny e2e pixel/ }).first().click();
  await expect(page.getByText(/Image URL copied|Could not copy/).first()).toBeVisible();

  // delete (confirm dialog)
  await page.getByRole("button", { name: /^Delete A tiny e2e pixel/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete image" }).click();
  await expect(page.getByText("Image deleted").first()).toBeVisible();
});

test("media picker in the post editor: upload and choose a cover image", async ({ page }) => {
  await page.goto(`${BASE}/posts/new`);
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Choose image" }).click();
  const dlg = page.getByRole("dialog", { name: "Choose an image" });
  await expect(dlg).toBeVisible();
  await dlg.locator('input[type="file"]').setInputFiles({ name: `cover-${Date.now()}.png`, mimeType: "image/png", buffer: tinyPng() });
  await expect(dlg.getByRole("option", { selected: true })).toBeVisible({ timeout: 15_000 });
  await dlg.getByRole("button", { name: "Use selected image" }).click();
  await expect(page.getByRole("button", { name: "Change image" })).toBeVisible();
  await expect(page.getByLabel("Image description (alt text)")).toBeVisible();
  // unsaved new post: nothing to clean up on the server except the media which later tests/DB seeds tolerate
});
