// Preview e2e (API + web + admin over the real Vercel routing). Run: node e2e.mjs
const BASE = process.env.BASE; // https://blog-git-...vercel.app
const BYPASS = process.env.BYPASS;
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const READER = { email: process.env.READER_EMAIL, password: process.env.READER_PASSWORD };
const CRON = process.env.CRON_SECRET;
const results = [];
const ok = (name, cond, info = "") => { results.push([cond ? "PASS" : "FAIL", name, info]); console.log(cond ? "PASS" : "FAIL", name, cond ? "" : info); };

class Jar { c = new Map(); set(res) { for (const s of res.headers.getSetCookie?.() ?? []) { const [kv] = s.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (v === "" || /max-age=0/i.test(s)) this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function req(path, { method = "GET", jar, body, headers = {}, origin = BASE, raw = false, redirect = "manual" } = {}) {
  const h = { "x-vercel-protection-bypass": BYPASS, ...headers };
  if (jar?.c.size) h.cookie = jar.header();
  if (method !== "GET" && origin) h.origin = origin;
  let payload = body;
  if (body && typeof body === "object" && !(body instanceof Uint8Array) && !(body instanceof FormData)) { payload = JSON.stringify(body); h["content-type"] = "application/json"; }
  const t = Date.now();
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect });
  jar?.set(res);
  const text = raw ? null : await res.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch {}
  return { status: res.status, headers: res.headers, text, json, ms: Date.now() - t, res };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Better Auth ships its own per-instance limiter (sign-in/email: 3 per 10 s): space sign-ins out
const signIn = async (jar, u, origin = BASE) => req("/api/auth/sign-in/email", { method: "POST", jar, body: u, origin });

// ---------------------------------------------------------------- health / boot
let r = await req("/api/health"); ok("health 200 + db up", r.status === 200 && r.json?.db === "up", JSON.stringify(r.json) + " " + r.ms + "ms");
r = await req("/api/health"); ok("health warm < 1500ms", r.ms < 1500, r.ms + "ms");

// ---------------------------------------------------------------- public API
r = await req("/api/posts?pageSize=3"); ok("posts list", r.status === 200 && r.json?.data?.length > 0 && r.json?.meta?.total >= 6, r.text?.slice(0, 200));
const first = r.json?.data?.[0];
ok("posts cacheable at the CDN (s-maxage is consumed by Vercel: header shows public)", /public/.test(r.headers.get("cache-control") ?? ""), r.headers.get("cache-control"));
r = await req(`/api/posts/${first.slug}`); ok("post detail has html+toc", r.status === 200 && r.json?.data?.contentHtml?.length > 50 && Array.isArray(r.json?.data?.toc), r.text?.slice(0, 120));
r = await req(`/api/posts/${first.slug}/related`); ok("related", r.status === 200 && Array.isArray(r.json?.data), r.status);
r = await req("/api/search?q=postgres"); ok("search", r.status === 200 && r.json?.data?.length > 0, r.text?.slice(0, 120));
r = await req("/api/tags"); ok("tags", r.status === 200 && r.json?.data?.length > 3);
r = await req("/api/sitemap"); ok("sitemap data", r.status === 200 && r.json?.data?.length > 3);
r = await req("/api/feed.xml"); ok("rss", r.status === 200 && /<rss/.test(r.text) && /xml/.test(r.headers.get("content-type")), r.headers.get("content-type"));
r = await req("/api/v1/openapi.json"); ok("v1 openapi", r.status === 200 && r.json?.openapi?.startsWith("3.1"));
r = await req("/api/v1/posts?pageSize=1", { headers: { origin: "https://example.org" } }); ok("v1 posts + CORS *", r.status === 200 && r.headers.get("access-control-allow-origin") === "*", r.headers.get("access-control-allow-origin"));
r = await req("/api/v1/comments?postSlug=" + first.slug); ok("v1 comments needs key", r.status === 401, r.status);
r = await req("/api/does-not-exist"); ok("api 404 envelope", r.status === 404 && r.json?.error?.code === "not_found", r.text?.slice(0, 100));

// ---------------------------------------------------------------- web pages (via public rewrites)
for (const [p, needle] of [["/", "Welcome"], ["/personal", "Personal"], ["/engineering", "Engineering"], [`/${first.section}/${first.slug}`, first.title.slice(0, 12)], ["/search?q=postgres", "postgres"], ["/about", ""], ["/login", ""], ["/signup", ""]]) {
  r = await req(p); ok(`web ${p}`, r.status === 200 && r.text.includes(needle.replace(/&/g, "&amp;")) || (r.status === 200 && !needle), `${r.status} ${r.ms}ms ${(r.text || "").slice(0, 80)}`);
}
r = await req("/feed.xml"); ok("web /feed.xml", r.status === 200 && /<rss/.test(r.text), `${r.status} ${r.text?.slice(0, 80)}`);
r = await req("/sitemap.xml"); ok("web /sitemap.xml has post urls + https host", r.status === 200 && r.text.includes(first.slug) && !/localhost/.test(r.text), r.text?.slice(0, 200));
r = await req("/robots.txt"); ok("robots no localhost", r.status === 200 && !/localhost/.test(r.text), r.text);
r = await req("/personal/this-does-not-exist"); ok("web 404", r.status === 404, r.status);
r = await req("/internal/revalidate", { method: "POST", body: { tags: ["posts"] } }); ok("revalidate rejects without secret", [401, 404].includes(r.status), r.status);
r = await req("/admin/login"); ok("admin login renders under /admin", r.status === 200 && /Sign in/.test(r.text) && /\/admin\/_next\//.test(r.text));
r = await req("/admin"); ok("admin w/o cookie redirects to login", [302, 303, 307, 308].includes(r.status) && /\/admin\/login/.test(r.headers.get("location") ?? ""), r.status + " " + r.headers.get("location"));
r = await req("/admin/_next/static/chunks/nonexistent.js"); ok("admin asset 404 (not web)", r.status === 404, r.status);

// ---------------------------------------------------------------- auth
const aj = new Jar();
r = await signIn(aj, { email: ADMIN.email, password: "wrong-password-123" }); ok("bad password rejected", r.status === 401 || r.status === 400, r.status + r.text?.slice(0, 100));
r = await signIn(aj, ADMIN, "https://evil.example.com"); ok("sign-in from evil origin blocked", r.status === 403, r.status + " " + r.text?.slice(0, 100));
await sleep(11000);
r = await signIn(aj, ADMIN); ok("admin sign-in", r.status === 200 && aj.c.size > 0, r.status + " " + r.text?.slice(0, 160));
const setCookie = r.headers.getSetCookie?.().join("\n") ?? "";
ok("session cookie flags (Secure; HttpOnly; SameSite=Lax; host-only)", /Secure/i.test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie) && !/Domain=/i.test(setCookie), setCookie.slice(0, 300));
ok("cookie name", [...aj.c.keys()].some((k) => /session_token/.test(k)), [...aj.c.keys()].join(","));
r = await req("/api/me", { jar: aj }); ok("/api/me admin", r.status === 200 && r.json?.data?.role === "admin", r.text?.slice(0, 160));
r = await req("/admin", { jar: aj }); ok("admin dashboard with cookie", r.status === 200, r.status + " " + r.headers.get("location"));
for (const p of ["/admin/posts", "/admin/media", "/admin/users", "/admin/comments", "/admin/newsletters", "/admin/subscribers", "/admin/api-keys", "/admin/settings", "/admin/posts/new"]) { r = await req(p, { jar: aj }); ok(`admin page ${p}`, r.status === 200 && !/Not authorised|could not load/i.test(r.text), r.status + " " + (r.text || "").slice(0, 80)); }
r = await req("/api/admin/stats", { jar: aj }); ok("admin stats", r.status === 200 && r.json?.data?.posts, r.text?.slice(0, 120));
r = await req("/api/admin/system", { jar: aj }); console.log("system:", JSON.stringify(r.json?.data));
ok("system: db/storage/data-api", r.status === 200 && r.json?.data?.dataApiExposure === "locked" && r.json?.data?.storage === "vercel-blob", JSON.stringify(r.json?.data));
// alias variant: sign in via the unique deployment URL host too is covered by BASE_ALT if set
await sleep(11000);
if (process.env.BASE_ALT) { const j2 = new Jar(); const saved = BASE; r = await fetch(process.env.BASE_ALT + "/api/auth/sign-in/email", { method: "POST", headers: { "x-vercel-protection-bypass": BYPASS, "content-type": "application/json", origin: process.env.BASE_ALT }, body: JSON.stringify(ADMIN) }); ok("sign-in via deployment-url origin", r.status === 200, String(r.status)); }
const rj = new Jar();
await sleep(11000);
r = await signIn(rj, READER); ok("reader sign-in", r.status === 200, r.status + " " + r.text?.slice(0, 120));
r = await req("/api/admin/stats", { jar: rj }); ok("reader forbidden on admin api", r.status === 403, r.status);
r = await req("/admin", { jar: rj }); ok("reader sees not-authorised in admin", r.status === 200 && /Not authorised|not authorised/i.test(r.text) || [302, 307].includes(r.status), r.status);
r = await req("/api/admin/stats"); ok("anon 401 on admin api", r.status === 401, r.status);

// ---------------------------------------------------------------- admin content lifecycle + revalidation chain + blob media
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fd = new FormData(); fd.append("file", new Blob([png], { type: "image/png" }), "pixel.png"); fd.append("alt", "e2e pixel");
r = await req("/api/admin/media", { method: "POST", jar: aj, body: fd }); ok("media upload to Vercel Blob", r.status === 201 && /^https:\/\/.+blob\.vercel-storage\.com\//.test(r.json?.data?.url ?? ""), r.status + " " + r.text?.slice(0, 200));
const mediaUrl = r.json?.data?.url; const mediaId = r.json?.data?.id;
if (mediaUrl) { const g = await fetch(mediaUrl); ok("blob public fetch", g.status === 200 && g.headers.get("content-type")?.startsWith("image/"), g.status); }
const slug = "e2e-" + Date.now().toString(36);
const content = { root: { type: "root", version: 1, direction: null, format: "", indent: 0, children: [{ type: "heading", tag: "h2", version: 1, direction: null, format: "", indent: 0, children: [{ type: "text", version: 1, text: "Serverless heading", format: 0, detail: 0, mode: "normal", style: "" }] }, { type: "paragraph", version: 1, direction: null, format: "", indent: 0, textFormat: 0, textStyle: "", children: [{ type: "text", version: 1, text: "Hello from the e2e run.", format: 0, detail: 0, mode: "normal", style: "" }] }] } };
r = await req("/api/admin/posts", { method: "POST", jar: aj, body: { title: "E2E serverless post " + slug, slug, section: "engineering", tags: ["e2e"], content, coverImageUrl: mediaUrl ?? null, coverImageAlt: "pixel", status: "draft" } }); ok("create draft", r.status === 201, r.status + " " + r.text?.slice(0, 200));
const pid = r.json?.data?.id;
r = await req(`/engineering/${slug}`); ok("draft not public (web 404)", r.status === 404, r.status);
r = await req(`/api/posts/${slug}`); ok("draft not public (api 404)", r.status === 404, r.status);
r = await req(`/api/admin/posts/${pid}/publish`, { method: "POST", jar: aj }); ok("publish", r.status === 200, r.status + " " + r.text?.slice(0, 200));
let seen = false, ms = 0; for (let i = 0; i < 10 && !seen; i++) { const t = Date.now(); const w = await req(`/engineering/${slug}`); if (w.status === 200 && w.text.includes("Serverless heading")) { seen = true; ms = Date.now() - t; } else await new Promise((s) => setTimeout(s, 1500)); }
ok("published post visible on web (revalidation chain)", seen, "");
r = await req("/engineering"); ok("listing shows new post", r.text.includes("E2E serverless post"), "");
r = await req(`/api/admin/posts/${pid}/unpublish`, { method: "POST", jar: aj }); ok("unpublish", r.status === 200, r.status);
seen = true; for (let i = 0; i < 10 && seen; i++) { const w = await req(`/engineering/${slug}`); if (w.status === 404) seen = false; else await new Promise((s) => setTimeout(s, 1500)); }
ok("unpublished post disappears from web (revalidation)", !seen, "");
// comments (reader) on an existing published post
r = await req(`/api/posts/${first.slug}/comments`, { method: "POST", jar: rj, body: { body: "e2e comment " + Date.now() } }); ok("reader comment", r.status === 201, r.status + " " + r.text?.slice(0, 160));
const cid = r.json?.data?.id;
r = await req(`/api/posts/${first.slug}/comments`, { jar: rj }); ok("comments list private cache", r.status === 200 && /no-store|private/.test(r.headers.get("cache-control") ?? ""), r.headers.get("cache-control"));
if (cid) { r = await req(`/api/comments/${cid}`, { method: "DELETE", jar: rj }); ok("delete own comment", r.status === 204, r.status); }
// newsletter
r = await req("/api/newsletter/subscribe", { method: "POST", body: { email: `e2e-${Date.now()}@example.com`, source: "e2e" } }); ok("newsletter subscribe 202", r.status === 202, r.status + " " + r.text?.slice(0, 120));
// api keys + v1 comments
r = await req("/api/admin/api-keys", { method: "POST", jar: aj, body: { name: "e2e", scopes: ["posts:read", "comments:read"] } }); ok("create api key", r.status === 201 && r.json?.data?.key?.startsWith("blg_"), r.status + " " + r.text?.slice(0, 100));
const key = r.json?.data?.key; const kid = r.json?.data?.id;
if (key) { r = await req("/api/v1/comments?postSlug=" + first.slug, { headers: { authorization: `Bearer ${key}` } }); ok("v1 comments with key", r.status === 200, r.status + " " + r.text?.slice(0, 100)); r = await req("/api/admin/api-keys/" + kid, { method: "DELETE", jar: aj }); ok("revoke key", [200, 204].includes(r.status), r.status); }
// cleanup
if (mediaId) { r = await req(`/api/admin/media/${mediaId}?force=true`, { method: "DELETE", jar: aj }); ok("delete media", [200, 204].includes(r.status), r.status + " " + r.text?.slice(0, 100)); }
if (pid) { r = await req(`/api/admin/posts/${pid}`, { method: "DELETE", jar: aj }); ok("delete post", r.status === 204, r.status); }
// cron
r = await req("/api/cron/publish-scheduled"); ok("cron without secret rejected", r.status === 401, r.status);
r = await req("/api/cron/publish-scheduled", { headers: { authorization: `Bearer ${CRON}` } }); ok("cron with secret", r.status === 200, r.status + " " + r.text?.slice(0, 120));
// shared (Postgres-backed) comment limiter: 10/min/user, consistent across instances
{ const made = []; const codes = []; for (let i = 0; i < 13; i++) { const x = await req(`/api/posts/${first.slug}/comments`, { method: "POST", jar: rj, body: { body: `limiter probe ${i} ${Date.now()}` } }); codes.push(x.status); if (x.status === 201) made.push(x.json.data.id); if (x.status === 429) ok("comment limiter envelope", x.json?.error?.code === "rate_limited", x.text?.slice(0, 120)); }
  ok("comment limiter (PG store) caps at 10/min", codes.filter((c) => c === 201).length <= 10 && codes.includes(429), codes.join(","));
  for (const id of made) await req(`/api/comments/${id}`, { method: "DELETE", jar: rj }); }
// sign-out
await sleep(11000);
r = await req("/api/auth/sign-out", { method: "POST", jar: aj, body: {} }); ok("sign-out", r.status === 200, r.status);
r = await req("/api/me", { jar: aj }); ok("/api/me after sign-out 401", r.status === 401, r.status);

// last: auth endpoint hammering must end in 429 (burns this IP's budget for a minute)
{ const j = new Jar(); const codes = []; for (let i = 0; i < 14; i++) { const x = await signIn(j, { email: "nobody@example.com", password: "x".repeat(12) }); codes.push(x.status); } ok("auth rate limit kicks in (429)", codes.includes(429), codes.join(",")); }
const fails = results.filter((x) => x[0] === "FAIL");
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) { console.log("FAILED:"); for (const f of fails) console.log(" -", f[1], f[2]); }
process.exit(fails.length ? 1 : 0);
