import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/** Use CHROMIUM_PATH, else any chromium under PLAYWRIGHT_BROWSERS_PATH. */
function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  const exe = dir && join(root, dir, "chrome-linux", "chrome");
  return exe && existsSync(exe) ? exe : undefined;
}

// Minimal config: the UI specs in e2e/ui expect a running site (BASE_URL,
// default http://localhost:3000), e.g. `pnpm --filter @blog/web build && start`.
export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    launchOptions: {
      executablePath: findChromium(),
      args: ["--no-sandbox"],
    },
  },
  // Projects: the public-site specs (BASE_URL) and the admin specs in e2e/admin (ADMIN_BASE_URL, default :3104;
  // start the API (:4104) and the admin (:3104) first, see e2e/admin/helpers.ts).
  projects: [
    { name: "site", testIgnore: "**/admin/**" },
    {
      name: "admin",
      testMatch: "admin/**/*.spec.ts",
      workers: 1,
      use: { baseURL: process.env.ADMIN_BASE_URL ?? "http://localhost:3104" },
    },
  ],
});
