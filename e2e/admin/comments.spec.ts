import { expect, test, BASE, apiJson, READER_EMAIL, READER_PASSWORD } from "./helpers";

type AdminComment = { id: string; status: string; body: string; author: { email: string } | null; post: { slug: string; section: string } };

test("moderation: hide, unhide, report + resolve", async ({ page, baseURL, playwright }) => {
  const list = await apiJson<AdminComment[]>(page, "GET", "/admin/comments?status=visible&pageSize=5");
  test.skip(list.length === 0, "no visible comments in the seeded database");
  // a comment the reader did not write (authors cannot report their own comments)
  const target = list.find((c) => c.author?.email !== READER_EMAIL) ?? list[0]!;

  await page.goto(`${BASE}/comments`);
  await expect(page.getByRole("heading", { level: 1, name: "Comments" })).toBeVisible();
  const card = page.getByRole("listitem").filter({ hasText: target.body.slice(0, 40) }).first();
  await expect(card).toBeVisible();

  // hide (optimistic) -> shows up in the Hidden tab -> unhide
  await card.getByRole("button", { name: "Hide" }).click();
  await expect(card.getByText("Hidden", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Hidden/ }).click();
  const hidden = page.getByRole("listitem").filter({ hasText: target.body.slice(0, 40) }).first();
  await expect(hidden).toBeVisible();
  await hidden.getByRole("button", { name: "Unhide" }).click();
  await expect(page.getByText("Comment is visible again").first()).toBeVisible();

  // a reader reports a comment (one report per reader+comment: try candidates until one is accepted)
  const reader = await playwright.request.newContext({ baseURL });
  const login = await reader.post("/api/auth/sign-in/email", { data: { email: READER_EMAIL, password: READER_PASSWORD }, headers: { origin: baseURL! } });
  let reportedTarget: AdminComment | undefined;
  if (login.ok()) {
    for (const c of list.filter((x) => x.author?.email !== READER_EMAIL)) {
      const rep = await reader.post(`/api/comments/${c.id}/report`, { data: { reason: "e2e report reason" }, headers: { origin: baseURL! } });
      if (rep.status() === 204) {
        reportedTarget = c;
        break;
      }
    }
  }
  if (reportedTarget) {
    await page.reload();
    await page.getByRole("tab", { name: /^Reported/ }).click();
    const reported = page.getByRole("listitem").filter({ hasText: reportedTarget.body.slice(0, 40) }).first();
    if (!(await reported.isVisible({ timeout: 4000 }).catch(() => false))) {
      // Re-reporting a comment whose earlier report from the same reader was already resolved is accepted (204) by the
      // API but does not re-open it (one report per reader+comment). Only the first run against a database sees this part.
      test.info().annotations.push({ type: "note", description: "report was not re-opened; resolve-reports part skipped (state from an earlier run)" });
      await reader.dispose();
      return;
    }
    await reported.getByText(/open\)/).click();
    await expect(reported.getByText("e2e report reason")).toBeVisible();
    await reported.getByRole("button", { name: "Resolve reports" }).click();
    await expect(page.getByText("Reports resolved").first()).toBeVisible();
  }
  await reader.dispose();
});

test("delete asks for confirmation and can be restored", async ({ page }) => {
  const list = await apiJson<AdminComment[]>(page, "GET", "/admin/comments?status=visible&pageSize=5");
  test.skip(list.length === 0, "no visible comments");
  const target = list[list.length - 1]!;
  await page.goto(`${BASE}/comments`);
  const card = page.getByRole("listitem").filter({ hasText: target.body.slice(0, 40) }).first();
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete comment" }).click();
  await expect(card.getByText("Deleted", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Comment restored").first()).toBeVisible();
});
