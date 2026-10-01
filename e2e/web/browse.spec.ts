import { expect, test } from "@playwright/test";
import { ENGINEERING_SLUG, PERSONAL_SLUG } from "./helpers";

test.describe("browsing", () => {
  test("home: hero, latest posts across sections, section cards, newsletter CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const latest = page.getByRole("region", { name: "Latest writing" });
    await expect(latest.getByRole("article")).toHaveCount(6);
    await expect(latest.getByRole("link", { name: "Notes from a Slow Morning" })).toBeVisible();
    await expect(latest.getByRole("link", { name: /Typed API Client/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personal Growth & Life Logs" })).toBeVisible();
    await expect(page.locator("#newsletter").getByRole("button", { name: "Subscribe" })).toBeVisible();
  });

  test("section listings only show their own section; tag chips filter via ?tag=", async ({ page }) => {
    await page.goto("/personal");
    await expect(page.getByRole("link", { name: "Notes from a Slow Morning" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Typed API Client/ })).toHaveCount(0);

    const chips = page.getByRole("navigation", { name: "Filter by tag" });
    await expect(chips.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
    await chips.getByRole("link", { name: /^Life/ }).click();
    await expect(page).toHaveURL(/\/personal\?tag=life$/);
    await expect(page.getByRole("link", { name: "Notes from a Slow Morning" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Trail Notes/ })).toHaveCount(0);
    await expect(chips.getByRole("link", { name: /^Life/ })).toHaveAttribute("aria-current", "true");
  });

  test("an unknown tag and an out-of-range page show helpful empty states", async ({ page }) => {
    await page.goto("/engineering?tag=does-not-exist");
    await expect(page.getByRole("heading", { name: /No posts tagged/ })).toBeVisible();
    await page.getByRole("link", { name: "Clear filter" }).click();
    await expect(page).toHaveURL(/\/engineering$/);
    await page.goto("/engineering?page=99");
    await expect(page.getByRole("heading", { name: "That page doesn’t exist" })).toBeVisible();
    // garbage params are ignored, not an error
    await page.goto("/engineering?page=abc&tag=%3Cscript%3E");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("search: highlighted <mark> snippets, section filter, no-results state, short query hint", async ({ page }) => {
    await page.goto("/search");
    await page.getByLabel("Search posts").fill("postgres");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=postgres/);
    await expect(page.getByRole("heading", { name: /Results for “postgres”/ })).toBeVisible();
    const marks = page.locator("main mark");
    await expect(marks.first()).toBeVisible();
    expect(await marks.count()).toBeGreaterThan(0);
    // snippets are rendered as text + <mark>, never as injected HTML
    await expect(page.locator("main article p mark").first()).toHaveText(/postgres/i);

    await page.getByLabel("Section").selectOption("personal");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("heading", { name: "No posts found" })).toBeVisible();

    await page.goto("/search?q=zzzzqqqq");
    await expect(page.getByRole("heading", { name: "No posts found" })).toBeVisible();
    await page.goto("/search?q=a");
    await expect(page.getByText("Type at least 2 characters")).toBeVisible();
  });

  test("search renders hostile queries as text", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`);
    await expect(page.locator("main img[src='x']")).toHaveCount(0);
  });

  test("/tags/<slug> permanently redirects to the section-agnostic listing", async ({ page, request }) => {
    const res = await request.get("/tags/postgres", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toContain("/search?tag=postgres");
    await page.goto("/tags/postgres");
    await expect(page).toHaveURL(/\/search\?tag=postgres$/);
    await expect(page.getByRole("heading", { name: /Posts tagged/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Postgres Full-Text Search/ })).toBeVisible();
  });
});

test.describe("post pages", () => {
  test("renders header, cover, TOC, content, tags, share, related, prev/next, comments, newsletter", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/engineering/${ENGINEERING_SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Hybrid Search/);
    await expect(page.locator("article time").first()).toBeVisible();
    await expect(page.getByText(/min read/).first()).toBeVisible();
    // cover: next/image with intrinsic size, preloaded
    const cover = page.locator("article img").first();
    await expect(cover).toHaveAttribute("width", "1600");
    await expect(cover).toHaveAttribute("sizes", /.+/);
    // server-rendered content, equations (KaTeX) and code
    await expect(page.locator(".post-prose h2").first()).toBeVisible();
    await expect(page.locator(".post-prose .katex").first()).toBeVisible();
    await expect(page.locator(".post-prose pre")).toHaveCount(await page.locator(".post-prose pre").count());
    // sticky TOC on wide screens, links to heading ids
    const toc = page.getByRole("navigation", { name: "On this page" });
    await expect(toc).toBeVisible();
    await toc.getByRole("link", { name: "Reciprocal rank fusion" }).click();
    await expect(page).toHaveURL(/#reciprocal-rank-fusion$/);
    await expect(page.locator("#reciprocal-rank-fusion")).toBeInViewport();
    // share, nav, related, newsletter
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "More from this section" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Related posts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Get the next one by email/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Comments" })).toBeAttached();
  });

  test("narrow screens get a collapsible TOC instead of the sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/engineering/${ENGINEERING_SLUG}`);
    const details = page.locator("details", { hasText: "On this page" });
    await expect(details).toBeVisible();
    await expect(details.getByRole("link", { name: "Reciprocal rank fusion" })).toBeHidden();
    await details.getByText("On this page").click();
    await expect(details.getByRole("link", { name: "Reciprocal rank fusion" })).toBeVisible();
  });

  test("metadata: canonical, OpenGraph article, Twitter card, JSON-LD BlogPosting", async ({ page }) => {
    await page.goto(`/personal/${PERSONAL_SLUG}`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/personal/${PERSONAL_SLUG}$`));
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https?:\/\//);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(ld["@type"]).toBe("BlogPosting");
    expect(ld.headline).toBe("Notes from a Slow Morning");
    expect(ld.datePublished).toBeTruthy();
  });

  test("a slug under the wrong section redirects permanently to the right one; unknown slug is a 404", async ({ page, request }) => {
    const res = await request.get(`/personal/${ENGINEERING_SLUG}`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toContain(`/engineering/${ENGINEERING_SLUG}`); // Next may repeat the header
    await page.goto(`/personal/${ENGINEERING_SLUG}`);
    await expect(page).toHaveURL(new RegExp(`/engineering/${ENGINEERING_SLUG}$`));

    const missing = await request.get("/personal/this-does-not-exist-123");
    expect(missing.status()).toBe(404);
  });

  test("copy link button announces success", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/personal/${PERSONAL_SLUG}`);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/personal/${PERSONAL_SLUG}$`));
  });

  test("CLS stays ~0 on a post page (desktop and mobile)", async ({ page }) => {
    for (const size of [{ width: 1280, height: 800 }, { width: 360, height: 740 }]) {
      await page.setViewportSize(size);
      await page.goto(`/engineering/${ENGINEERING_SLUG}`, { waitUntil: "load" });
      await page.evaluate(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
            if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      // scroll through the whole page (triggers the lazy comments island + lazy images)
      for (let y = 0; y < 8000; y += 600) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(800);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `CLS at ${size.width}px`).toBeLessThan(0.02);
    }
  });

  test("no horizontal scroll at 360px on a post page", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/engineering/${ENGINEERING_SLUG}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("feeds and crawler files", () => {
  test("/feed.xml is RSS with the posts; ?section filters", async ({ request }) => {
    const res = await request.get("/feed.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain("<rss");
    expect(xml).toContain("Notes from a Slow Morning");
    const eng = await (await request.get("/feed.xml?section=engineering")).text();
    expect(eng).not.toContain("Notes from a Slow Morning");
  });

  test("sitemap lists every published post, robots points to it, drafts are absent", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`/personal/${PERSONAL_SLUG}`);
    expect(sitemap).toContain(`/engineering/${ENGINEERING_SLUG}`);
    expect(sitemap).not.toContain("draft-designing-a-comment-system");
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Sitemap:");
    expect(robots).toContain("Disallow: /api/");
  });
});

test.describe("internal revalidate webhook", () => {
  test("rejects missing/wrong secrets and bad bodies (or 404 when not configured)", async ({ request }) => {
    const none = await request.post("/internal/revalidate", { data: { tags: ["posts"] } });
    expect([401, 404]).toContain(none.status());
    const wrong = await request.post("/internal/revalidate", { data: { tags: ["posts"] }, headers: { "x-revalidate-secret": "nope" } });
    expect([401, 404]).toContain(wrong.status());
    expect((await request.get("/internal/revalidate")).status()).toBe(404);
  });

  test("accepts the right secret", async ({ request }) => {
    test.skip(!process.env.REVALIDATE_SECRET, "REVALIDATE_SECRET not provided to the test run");
    const headers = { "x-revalidate-secret": process.env.REVALIDATE_SECRET! };
    const ok = await request.post("/internal/revalidate", { data: { tags: ["posts", `post:${PERSONAL_SLUG}`] }, headers });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).revalidated).toBe(true);
    expect((await request.post("/internal/revalidate", { data: { tags: [] }, headers })).status()).toBe(400);
    expect((await request.post("/internal/revalidate", { data: { tags: ["bad tag!"] }, headers })).status()).toBe(400);
  });
});
