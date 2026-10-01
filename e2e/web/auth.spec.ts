import { expect, test } from "@playwright/test";
import { createVerifiedUser, hasMailLog, mailLink, READER, signIn, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("sign up, verify, sign in, account", () => {
  test("sign up shows 'check your email', a resend action, verifies via the emailed link, then signs in", async ({ page }) => {
    test.skip(!hasMailLog(), "needs API_LOG_FILE (console mailer output)");
    const email = uniqueEmail("signup");
    await page.goto("/signup");
    await page.getByRole("main").getByLabel("Name").fill("Sign Up Tester");
    await page.getByRole("main").getByLabel("Email address").fill(email);

    // weak password: announced, not submitted
    await page.getByRole("main").getByLabel("Password", { exact: true }).fill("short");
    await expect(page.getByText(/Too short/)).toBeVisible();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();

    await page.getByRole("main").getByLabel("Password", { exact: true }).fill("Correct-horse-battery-9");
    await expect(page.getByText("Strong password")).toBeVisible();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Check your email" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // not verified yet: signing in is refused with a clear message and a resend option
    await page.goto("/login");
    await page.getByRole("main").getByLabel("Email address").fill(email);
    await page.getByRole("main").getByLabel("Password", { exact: true }).fill("Correct-horse-battery-9");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: /verify your email/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();

    // resend produces a (new) link
    await page.getByRole("button", { name: "Resend verification email" }).click();
    await expect(page.getByText(/new link is on its way/)).toBeVisible();

    const link = await mailLink(email, /verify-email\?token=/);
    await page.goto(link);
    await expect(page).toHaveURL(/\/verify-email\?verified=1/);
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();

    // verification auto-signs the user in (Better Auth) → header shows the account link
    await expect(page.getByRole("link", { name: "Account" }).first()).toBeAttached();
    await page.context().clearCookies();
    await signIn(page, email, "Correct-horse-battery-9");
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  });

  test("a bad verification link explains itself and offers a new one", async ({ page }) => {
    await page.goto("/api/auth/verify-email?token=garbage&callbackURL=%2Fverify-email%3Fverified%3D1");
    await expect(page.getByRole("heading", { name: "That link didn't work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  });

  test("wrong password gives one neutral message", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("main").getByLabel("Email address").fill(READER.email);
    await page.getByRole("main").getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("didn't work");
    await page.getByRole("main").getByLabel("Email address").fill("nobody@example.com");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("didn't work");
  });

  test("sign in as the seeded reader, header reflects it without layout shift, account actions work, sign out", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const header = page.getByRole("banner");
    const before = await header.boundingBox();
    const pillBefore = await header.getByRole("link", { name: "Sign in" }).boundingBox();
    await signIn(page, READER.email, READER.password, "/account");
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByText("Verified", { exact: true })).toBeVisible();
    await page.goto("/");
    const pillAfter = await header.getByRole("link", { name: "Account" }).boundingBox();
    expect((await header.boundingBox())?.height).toBe(before?.height);
    expect(pillAfter?.width).toBe(pillBefore?.width);
    expect(pillAfter?.x).toBe(pillBefore?.x);

    // profile name edit
    await page.goto("/account");
    const name = page.getByRole("main").getByLabel("Display name");
    await name.fill("Demo Reader Renamed");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await name.fill(READER.name);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();

    // newsletter toggle (verified user: instantly confirmed)
    const toggle = page.getByRole("main").getByRole("button", { name: /^(Subscribe|Unsubscribe)$/ }).first();
    const initially = await toggle.textContent();
    await toggle.click();
    await expect(page.getByRole("main").getByRole("button", { name: initially === "Subscribe" ? "Unsubscribe" : "Subscribe" })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: initially === "Subscribe" ? "Unsubscribe" : "Subscribe" }).click();
    await expect(page.getByRole("main").getByRole("button", { name: initially!.trim() })).toBeVisible();

    // wrong current password is reported
    await page.getByRole("main").getByLabel("Current password").fill("not-my-password");
    await page.getByRole("main").getByLabel("New password", { exact: true }).last().fill("Another-long-password-1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your current password is incorrect.")).toBeVisible();

    // sign out
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("header").getByRole("link", { name: "Sign in" })).toBeVisible();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  });

  test("?next= only honours same-origin paths (open-redirect protection)", async ({ page }) => {
    for (const evil of ["//evil.example.com", "https://evil.example.com", "/\\evil.example.com", "javascript:alert(1)"]) {
      await signIn(page, READER.email, READER.password, evil);
      const url = new URL(page.url());
      expect(url.origin).toBe(new URL(page.url()).origin);
      expect(url.hostname).not.toContain("evil");
      await page.context().clearCookies();
    }
    await signIn(page, READER.email, READER.password, "/about");
    await expect(page).toHaveURL(/\/about$/);
  });

  test("forgot password is enumeration-safe and a reset link changes the password", async ({ page, request }) => {
    test.skip(!hasMailLog(), "needs API_LOG_FILE (console mailer output)");
    const user = await createVerifiedUser(request, "Reset Tester");
    await page.goto("/forgot-password");
    await page.getByRole("main").getByLabel("Email address").fill("nobody-at-all@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If an account exists/)).toBeVisible();

    await page.goto("/forgot-password");
    await page.getByRole("main").getByLabel("Email address").fill(user.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If an account exists/)).toBeVisible();

    const link = await mailLink(user.email, /reset-password/);
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await page.getByRole("main").getByLabel("New password", { exact: true }).fill("Brand-new-passphrase-77");
    await page.getByRole("main").getByLabel("Confirm new password").fill("Brand-new-passphrase-78");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("don't match");
    await page.getByRole("main").getByLabel("Confirm new password").fill("Brand-new-passphrase-77");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText("Your password has been updated.")).toBeVisible();
    await signIn(page, user.email, "Brand-new-passphrase-77");
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("reset-password without a valid token explains the problem", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await page.goto("/reset-password?token=garbagegarbage");
    await page.getByRole("main").getByLabel("New password", { exact: true }).fill("Brand-new-passphrase-77");
    await page.getByRole("main").getByLabel("Confirm new password").fill("Brand-new-passphrase-77");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(/invalid or has expired/i);
  });

  test("delete account requires typed confirmation, anonymises, and ends the session", async ({ page, request }) => {
    test.skip(!hasMailLog(), "needs API_LOG_FILE (console mailer output)");
    const user = await createVerifiedUser(request, "Delete Me");
    await signIn(page, user.email, user.password, "/account");
    await page.getByRole("button", { name: "Delete my account…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Type/).fill("delete");
    await confirm.click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/login");
    await page.getByRole("main").getByLabel("Email address").fill(user.email);
    await page.getByRole("main").getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("didn't work");
  });
});
