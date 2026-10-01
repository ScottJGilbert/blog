import { expect, test, apiJson, BASE } from "./helpers";

test.describe.configure({ mode: "serial" });

test("dashboard shows stats and recent items", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Published posts")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent posts" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
});

test("posts list: filter, search and paginate", async ({ page }) => {
  await page.goto(`${BASE}/posts`);
  await expect(page.getByRole("table", { name: undefined })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  await page.getByLabel("Status").selectOption("published");
  await expect(page).toHaveURL(/status=published/);
  await page.getByLabel("Section").selectOption("engineering");
  await expect(page).toHaveURL(/section=engineering/);
  await page.getByRole("searchbox", { name: "Search posts" }).fill("zzzz-no-such-post");
  await expect(page.getByText("No posts match these filters")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(rows.first()).toBeVisible();
});

test("create, autosave, edit, publish, unpublish and delete a post with the real editor", async ({ page, context }) => {
  const title = `E2E post ${Date.now()}`;
  await page.goto(`${BASE}/posts/new`);
  await expect(page.getByRole("heading", { level: 1, name: "New post" })).toBeVisible();

  // The package's "Welcome" text must not be pre-filled.
  const editable = page.locator(".editor-shell [contenteditable='true']").first();
  await expect(editable).toBeVisible({ timeout: 20_000 });
  await expect(editable).not.toContainText("Welcome");

  await page.getByLabel(/^Title/).fill(title);
  await expect(page.getByLabel("URL slug")).toHaveValue(title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));

  await editable.click();
  await page.keyboard.type("Hello from the end-to-end test. ");
  await page.keyboard.type("Second sentence with **bold** text.");

  // tags
  const tags = page.getByRole("combobox", { name: "Tags" });
  await tags.fill("e2e");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove tag e2e" })).toBeVisible();

  // autosave creates the draft and moves the URL to /posts/<id> without remounting the editor
  await expect(page.getByRole("status").filter({ hasText: /Saved at/ })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`${BASE}/posts/[0-9a-f-]{36}$`));
  await expect(editable).toContainText("Hello from the end-to-end test");
  const id = page.url().split("/").pop()!;

  // content is stored as Lexical JSON
  const saved = await apiJson<{ title: string; status: string; content: { root: { children: unknown[] } }; tags: { name: string }[] }>(page, "GET", `/admin/posts/${id}`);
  expect(saved.status).toBe("draft");
  expect(saved.tags.map((t) => t.name)).toContain("e2e");
  expect(JSON.stringify(saved.content)).toContain("Hello from the end-to-end test");

  // explicit save of a change
  await page.getByLabel(/^Title/).fill(`${title} (edited)`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Saved at/ })).toBeVisible();

  // publish
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 }).getByText("Published")).toBeVisible();
  const link = page.getByRole("link", { name: /View on site/ });
  await expect(link).toHaveAttribute("href", /\/(personal|engineering)\/e2e-post-/);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.getByText("Autosave is only on for drafts")).toBeVisible();

  // unpublish (confirm dialog)
  await page.getByRole("button", { name: "Unpublish" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByRole("heading", { level: 1 }).getByText("Draft")).toBeVisible();

  // unsaved-changes guard on in-app navigation (no autosave while the confirm dialog is up for a failed flush is not
  // needed here: make the change invalid so flush cannot succeed)
  await page.getByLabel(/^Title/).fill("");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Media" }).click();
  const dlg = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`/posts/${id}$`));
  await page.getByLabel(/^Title/).fill(`${title} (edited)`);

  // delete
  await page.getByRole("button", { name: "More post actions" }).click();
  await page.getByRole("menuitem", { name: /Delete post/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete post" }).click();
  await expect(page).toHaveURL(`${BASE}/posts`);
  void context;
});

test("validation errors are shown inline and a bad slug is mapped to the slug field", async ({ page }) => {
  await page.goto(`${BASE}/posts/new`);
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Add a title.")).toBeVisible();
  await expect(page.getByLabel(/^Title/)).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel(/^Title/).fill("Slug test");
  await page.getByLabel("URL slug").fill("Not A Slug!!");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/lowercase letters, digits/)).toBeVisible();
});

test("schedule dialog shows the time zone and rejects past times", async ({ page }) => {
  const created = await apiJson<{ id: string }>(page, "POST", "/admin/posts", {
    title: `Schedule me ${Date.now()}`,
    section: "personal",
    tags: [],
    content: { root: { type: "root", version: 1, direction: null, format: "", indent: 0, children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "x", detail: 0, format: 0, mode: "normal", style: "" }], direction: null, format: "", indent: 0, textFormat: 0, textStyle: "" }] } },
  });
  try {
    await page.goto(`${BASE}/posts/${created.id}`);
    await page.getByRole("button", { name: "Schedule…" }).click();
    const dlg = page.getByRole("dialog", { name: "Schedule post" });
    await expect(dlg.getByText(/Time zone:/)).toBeVisible();
    await dlg.getByLabel("Publish on").fill("2020-01-01T10:00");
    await dlg.getByRole("button", { name: "Schedule post" }).click();
    await expect(dlg.getByText("Choose a time in the future.")).toBeVisible();
    const future = new Date(Date.now() + 3 * 86400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await dlg.getByLabel("Publish on").fill(`${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T10:00`);
    await dlg.getByRole("button", { name: "Schedule post" }).click();
    await expect(page.getByRole("heading", { level: 1 }).getByText("Scheduled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel schedule" })).toBeVisible();
  } finally {
    await apiJson(page, "DELETE", `/admin/posts/${created.id}`).catch(() => {});
  }
});
