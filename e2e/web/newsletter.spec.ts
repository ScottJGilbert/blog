import { expect, test } from "@playwright/test";
import { ENGINEERING_SLUG, hasMailLog, mailLink, uniqueEmail } from "./helpers";

test.describe("newsletter", () => {
  test("footer form validates, then subscribes (double opt-in) and the emailed link confirms", async ({ page }) => {
    test.skip(!hasMailLog(), "needs API_LOG_FILE (console mailer output)");
    await page.goto("/about");
    const form = page.getByRole("contentinfo").getByRole("form").or(page.getByRole("contentinfo").locator("form"));
    await form.getByRole("button", { name: "Subscribe" }).click();
    await expect(form.getByText("Please enter your email address.")).toBeVisible();

    const email = uniqueEmail("news");
    await form.getByLabel("Email address").fill(email);
    await form.getByRole("button", { name: "Subscribe" }).click();
    await expect(form.getByRole("status")).toContainText("Check your inbox");

    const link = await mailLink(email, /newsletter\/confirm\?token=/);
    await page.goto(link);
    // opening the link changes nothing (mail scanners open links): the visitor confirms with a button
    await expect(page.getByRole("heading", { name: "Confirm your subscription" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm subscription" }).click();
    await expect(page.getByRole("heading", { name: "You're subscribed" })).toBeFocused();
    // a second visit with a spent token is a clear error, not a crash
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm subscription" }).click();
    await expect(page.getByRole("heading", { name: /You're subscribed|This link didn't work/ })).toBeVisible();

    // the confirmation email also carries the unsubscribe link (same two-step flow)
    const unsubscribe = await mailLink(email, /newsletter\/unsubscribe\?token=/);
    await page.goto(unsubscribe);
    await expect(page.getByRole("heading", { name: "Unsubscribe from the newsletter?" })).toBeVisible();
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
  });

  test("home and post-end forms are wired; the footer one is hidden where a CTA exists", async ({ page }) => {
    test.skip(!hasMailLog(), "needs API_LOG_FILE (console mailer output)");
    await page.goto("/");
    await expect(page.getByRole("contentinfo").locator("form")).toHaveCount(0);
    const email = uniqueEmail("home");
    await page.locator("#newsletter").getByLabel("Email address").fill(email);
    await page.locator("#newsletter").getByRole("button", { name: "Subscribe" }).click();
    await expect(page.locator("#newsletter").getByRole("status")).toContainText("Check your inbox");
    await mailLink(email, /newsletter\/confirm\?token=/);

    await page.goto(`/engineering/${ENGINEERING_SLUG}`);
    await expect(page.getByRole("contentinfo").locator("form")).toHaveCount(0);
    const postForm = page.getByRole("region", { name: /Get the next one by email/ });
    await postForm.getByLabel("Email address").fill("not-an-email");
    await postForm.getByRole("button", { name: "Subscribe" }).click();
    await expect(postForm.getByRole("status")).toContainText(/valid email|Something went wrong/);
  });

  test("invalid confirm/unsubscribe links show clear error states", async ({ page }) => {
    await page.goto("/newsletter/confirm?token=definitely-not-valid");
    await page.getByRole("button", { name: "Confirm subscription" }).click();
    await expect(page.getByRole("heading", { name: "This link didn't work" })).toBeVisible();
    await page.goto("/newsletter/confirm");
    await expect(page.getByRole("heading", { name: "This link didn't work" })).toBeVisible();
    await page.goto("/newsletter/unsubscribe?token=definitely-not-valid");
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(page.getByRole("heading", { name: "This link didn't work" })).toBeVisible();
  });
});
