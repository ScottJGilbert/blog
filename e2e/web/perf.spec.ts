import { expect, test } from "@playwright/test";
import { ENGINEERING_SLUG, PERSONAL_SLUG } from "./helpers";

/**
 * Real (not simulated) throttling: Slow 4G (1.6 Mbps / 150 ms RTT), 4x CPU, cold cache, 412x823 @1.75 DPR.
 * Budget from SPEC §7: LCP < 2.5 s, CLS < 0.05 (target 0).
 */
const PAGES = ["/", "/personal", "/engineering", `/personal/${PERSONAL_SLUG}`, `/engineering/${ENGINEERING_SLUG}`, "/search?q=postgres", "/login"];

for (const path of PAGES) {
  test(`web vitals under Slow 4G: ${path}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      const w = window as unknown as { __lcp: number; __cls: number };
      w.__lcp = 0;
      w.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(path, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const { lcp, cls } = await page.evaluate(() => {
      const w = window as unknown as { __lcp: number; __cls: number };
      return { lcp: w.__lcp, cls: w.__cls };
    });
    expect(lcp, "LCP ms").toBeGreaterThan(0);
    expect(lcp, "LCP ms").toBeLessThan(2500);
    expect(cls, "CLS").toBeLessThan(0.05);
    await context.close();
  });
}
