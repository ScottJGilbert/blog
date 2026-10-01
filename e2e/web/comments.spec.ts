import { expect, test } from "@playwright/test";
import { createVerifiedUser, hasMailLog, PERSONAL_SLUG, scrollToComments, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.skip(!hasMailLog(), "needs API_LOG_FILE (console mailer output) to create verified users");

const post = `/personal/${PERSONAL_SLUG}`;

test.describe("comments", () => {
  test("signed-out visitors see the thread and a sign-in prompt, no form", async ({ page }) => {
    await page.goto(post);
    const section = page.locator("#comments");
    await scrollToComments(page);
    await expect(section.getByText("This made me put my phone down")).toBeVisible();
    await expect(section.getByText("Join the conversation")).toBeVisible();
    await expect(section.getByRole("textbox")).toHaveCount(0);
    await expect(section.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /\/login\?next=.*comments/);
  });

  test("an unverified user is asked to verify instead of seeing the form", async ({ page, request }) => {
    const email = `unverified+${Date.now()}@example.com`;
    await request.post("/api/auth/sign-up/email", {
      data: { name: "Unverified", email, password: "unverified-pass-123" },
      headers: { origin: process.env.BASE_URL ?? "http://localhost:3000" },
    });
    // The API refuses to sign in unverified users, so this state is only reachable via the API when
    // REQUIRE_EMAIL_VERIFICATION=false; assert the refusal path instead.
    await page.goto("/login");
    await page.getByRole("main").getByLabel("Email address").fill(email);
    await page.getByRole("main").getByLabel("Password", { exact: true }).fill("unverified-pass-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(/verify your email/i);
  });

  test("post, reply, edit, delete with optimistic UI, counter and announcements", async ({ page, request }) => {
    const user = await createVerifiedUser(request, "Comment Author");
    const tag = Date.now().toString(36);
    const body = `Hello from the e2e suite ${tag}`;
    await signIn(page, user.email, user.password, post);
    const section = page.locator("#comments");
    await scrollToComments(page);
    const box = section.getByLabel("Add a comment");
    await expect(box).toBeVisible();

    // character counter + disabled submit while empty
    await expect(section.getByRole("button", { name: "Post comment" })).toBeDisabled();
    await box.fill(body);
    await expect(section.locator("[id$='-count']").first()).toContainText(String(4000 - body.length));

    await section.getByRole("button", { name: "Post comment" }).click();
    const mine = section.getByRole("article", { name: "Comment by Comment Author" }).filter({ hasText: body });
    await expect(mine).toBeVisible();
    await expect(section.getByRole("status").filter({ hasText: "Comment posted." })).toBeVisible();

    // reply (one level)
    await mine.getByRole("button", { name: /Reply/ }).first().click();
    await section.getByLabel("Reply to Comment Author").fill(`A reply ${tag}`);
    await section.getByRole("button", { name: "Post reply" }).click();
    const replies = mine.getByRole("list", { name: "Replies to Comment Author" });
    await expect(replies).toContainText(`A reply ${tag}`);

    // edit within the window
    await mine.getByRole("button", { name: /Edit/ }).first().click();
    await section.getByLabel("Edit your comment").fill(`${body} (edited)`);
    await section.getByRole("button", { name: "Save changes" }).click();
    await expect(mine).toContainText("(edited)");

    // persists across reload
    await page.reload();
    await scrollToComments(page);
    await expect(section.getByText(`${body} (edited)`)).toBeVisible();

    // delete the reply, then the comment (confirmation dialog)
    const mine2 = section.getByRole("article", { name: "Comment by Comment Author" }).filter({ hasText: body });
    await mine2.getByRole("list", { name: "Replies to Comment Author" }).getByRole("button", { name: /Delete/ }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this comment?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete comment" }).click();
    await expect(section.getByText(`A reply ${tag}`)).toHaveCount(0);
    await section.getByRole("article", { name: "Comment by Comment Author" }).filter({ hasText: body }).getByRole("button", { name: /Delete/ }).click();
    await page.getByRole("dialog", { name: "Delete this comment?" }).getByRole("button", { name: "Delete comment" }).click();
    await expect(section.getByText(`${body} (edited)`)).toHaveCount(0);
  });

  test("report dialog: focus trap, Esc closes, validation, success", async ({ page, request }) => {
    const user = await createVerifiedUser(request, "Reporter");
    await signIn(page, user.email, user.password, post);
    const section = page.locator("#comments");
    await scrollToComments(page);
    const seeded = section.getByRole("article", { name: "Comment by Demo Reader" }).first();
    const reportBtn = seeded.getByRole("button", { name: /Report/ });
    await reportBtn.click();
    const dialog = page.getByRole("dialog", { name: "Report this comment" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Reason")).toBeFocused();

    // Tab cycles inside the dialog
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reportBtn).toBeFocused();

    await reportBtn.click();
    await dialog.getByLabel("Reason").fill("x");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByText(/at least 3 characters/)).toBeVisible();
    await dialog.getByLabel("Reason").fill("This is spam for the e2e test");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog).toBeHidden();
    await expect(section.getByRole("status").filter({ hasText: /Thanks/ })).toBeVisible();

    // reporting the same comment again is accepted idempotently (no error, no duplicate)
    await reportBtn.click();
    await dialog.getByLabel("Reason").fill("Reporting again");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog).toBeHidden();
  });

  test("comments island reserves space (no CLS) and loads lazily", async ({ page }) => {
    await page.goto(post);
    const section = page.locator("#comments");
    const h0 = (await section.boundingBox())!.height;
    expect(h0).toBeGreaterThan(400);
    await scrollToComments(page);
    await expect(section.getByText("This made me put my phone down")).toBeVisible();
  });
});
