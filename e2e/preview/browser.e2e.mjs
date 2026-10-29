// Real-browser pass against a Vercel preview (run inside a Vercel Sandbox: needs `npm i playwright` + chromium).
import { chromium } from "playwright";
const BASE = process.env.BASE, BYPASS = process.env.BYPASS;
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const READER = { email: process.env.READER_EMAIL, password: process.env.READER_PASSWORD };
const results = [];
const ok = (n, c, i = "") => { results.push(c); console.log(c ? "PASS" : "FAIL", n, c ? "" : i); };
const browser = await chromium.launch({ args: ["--no-sandbox"] });
async function ctxFor(viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/vercel\.live|favicon|Failed to load resource: the server responded with a status of (401|404)/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
  // set the Deployment Protection bypass cookie once (first-party), no secret header leaks to third-party hosts
  await page.goto(`${BASE}/?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=samesitenone`, { waitUntil: "domcontentloaded" });
  return { ctx, page, errors };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- public site, desktop
{
  const { ctx, page, errors } = await ctxFor({ width: 1280, height: 800 });
  const t0 = Date.now(); await page.goto(`${BASE}/`, { waitUntil: "networkidle" }); ok("home loads", (await page.title()).length > 0, await page.title());
  ok("home has one h1", (await page.locator("h1").count()) === 1);
  const fonts = await page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily.split(",")[0]);
  ok("heading font is Epilogue", /Epilogue/i.test(fonts), fonts);
  await page.goto(`${BASE}/engineering`, { waitUntil: "networkidle" });
  const link = page.locator("main a[href^='/engineering/'], main a[href^='/personal/']").first();
  const href = await link.getAttribute("href"); ok("listing has post links", !!href, href);
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  ok("post page renders content", (await page.locator("article, .blog-prose, main").first().innerText()).length > 200);
  const cls = await page.evaluate(() => new Promise((res) => { let v = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) v += e.value; })).observe({ type: "layout-shift", buffered: true }); setTimeout(() => res(v), 800); }));
  ok("post CLS < 0.05", cls < 0.05, String(cls));
  // sign in as reader through the real form
  await sleep(11000);
  await page.goto(`${BASE}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).first().fill(READER.email); await page.getByLabel(/password/i).first().fill(READER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => u.pathname === "/account", { timeout: 25000 }).catch(() => {});
  ok("reader login lands on /account", new URL(page.url()).pathname === "/account", page.url() + " :: " + (await page.locator("[role=alert], [aria-live]").allInnerTexts()).join("|").slice(0, 300));
  await page.getByText(READER.email).first().waitFor({ timeout: 15000 }).catch(() => {});
  ok("account shows email", (await page.locator("body").innerText()).includes(READER.email), (await page.locator("main").innerText()).slice(0, 200));
  const cookies = await ctx.cookies(); const sess = cookies.find((c) => /session_token/.test(c.name));
  ok("session cookie Secure+HttpOnly", !!sess && sess.secure && sess.httpOnly, JSON.stringify(sess && { n: sess.name, s: sess.secure, h: sess.httpOnly }));
  // reload keeps session & header state
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" }); ok("header shows account state after reload", /account/i.test(await page.getByRole("banner").first().innerText()), (await page.getByRole("banner").first().innerText()).slice(0, 100));
  // admin must refuse a reader
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" }); ok("reader blocked from admin UI", /not authori[sz]ed/i.test(await page.locator("body").innerText()) || /\/admin\/login/.test(page.url()), page.url());
  ok("public pages: no console/5xx errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
// ---------------------------------------------------------------- public site, mobile 360
{
  const { ctx, page, errors } = await ctxFor({ width: 360, height: 740 });
  for (const p of ["/", "/personal", "/engineering", "/search?q=postgres", "/login"]) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`mobile no horizontal scroll ${p}`, overflow <= 1, String(overflow));
  }
  ok("mobile: no console/5xx errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
// ---------------------------------------------------------------- admin
{
  const { ctx, page, errors } = await ctxFor({ width: 1280, height: 800 });
  await sleep(11000);
  await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).first().fill(ADMIN.email); await page.getByLabel("Password", { exact: false }).first().fill(ADMIN.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(u.pathname), { timeout: 25000 }).catch(() => {});
  ok("admin login form -> dashboard", /\/admin\/?$/.test(new URL(page.url()).pathname), page.url());
  await page.getByText(/^Loading statistics/).first().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
  ok("dashboard shows stats", /published/i.test(await page.locator("main").innerText()), (await page.locator("main").innerText()).slice(0, 200));
  await page.goto(`${BASE}/admin/posts`, { waitUntil: "networkidle" }); ok("posts table lists seed posts", (await page.locator("table tbody tr").count()) >= 6, String(await page.locator("table tbody tr").count()));
  // editor
  await page.goto(`${BASE}/admin/posts/new`, { waitUntil: "networkidle" });
  const title = "Browser e2e " + Date.now().toString(36);
  await page.getByLabel("Title").fill(title);
  const editor = page.locator('[contenteditable="true"]').first(); await editor.waitFor({ timeout: 30000 }); await editor.click(); await page.keyboard.type("Typed by the browser e2e run.");
  const saved = await page.getByText(/^Saved at|All changes saved/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false); ok("editor autosaves a new draft", saved);
  ok("URL moved to /admin/posts/<id>", /\/admin\/posts\/[0-9a-f-]{36}/.test(page.url()), page.url());
  const id = page.url().match(/posts\/([0-9a-f-]{36})/)?.[1];
  await page.getByRole("button", { name: /^publish$/i }).click();
  await page.getByRole("button", { name: /^publish$/i }).last().click({ timeout: 3000 }).catch(() => {});
  await sleep(4000);
  const api = await ctx.request.get(`${BASE}/api/admin/posts/${id}`); const st = (await api.json())?.data?.status; ok("post published via UI", st === "published", String(st));
  const slug = (await (await ctx.request.get(`${BASE}/api/admin/posts/${id}`)).json())?.data?.slug;
  let pub = 0; for (let i = 0; i < 8 && pub !== 200; i++) { pub = (await ctx.request.get(`${BASE}/engineering/${slug}`)).status(); if (pub !== 200) await sleep(1500); } ok("published post is live on the public site", pub === 200, String(pub));
  for (const p of ["/admin/media", "/admin/users", "/admin/comments", "/admin/subscribers", "/admin/newsletters", "/admin/api-keys", "/admin/settings"]) { await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }); ok(`admin ${p} renders`, !(await page.locator("body").innerText()).match(/could not load|Not authori/i)); }
  await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" }); const body = await page.locator("main").innerText(); ok("settings shows vercel-blob + locked data API", /vercel-blob/i.test(body) && /locked/i.test(body), body.slice(0, 300));
  if (id) await ctx.request.delete(`${BASE}/api/admin/posts/${id}`, { headers: { origin: BASE } });
  ok("admin: no console/5xx errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close();
const bad = results.filter((x) => !x).length; console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
