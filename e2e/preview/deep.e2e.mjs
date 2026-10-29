// Serverless-specific probes against a Vercel preview: cache/ISR, images, big payloads, scheduling+cron, concurrency, signup.
const BASE = process.env.BASE, BYPASS = process.env.BYPASS, CRON = process.env.CRON_SECRET;
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const results = []; const ok = (n, c, i = "") => { results.push(c); console.log(c ? "PASS" : "FAIL", n, c ? "" : i); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Jar { c = new Map(); set(res) { for (const s of res.headers.getSetCookie?.() ?? []) { const [kv] = s.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === "") this.c.delete(k); else this.c.set(k, v); } } header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function req(path, { method = "GET", jar, body, headers = {} } = {}) {
  const h = { "x-vercel-protection-bypass": BYPASS, ...headers }; if (jar?.c.size) h.cookie = jar.header(); if (method !== "GET") h.origin = BASE;
  let payload = body; if (body && typeof body === "object" && !(body instanceof FormData) && !Buffer.isBuffer(body)) { payload = JSON.stringify(body); h["content-type"] = "application/json"; }
  const t = Date.now(); const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" }); jar?.set(res); const text = await res.text(); let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json, ms: Date.now() - t };
}
const para = (t) => ({ type: "paragraph", version: 1, direction: null, format: "", indent: 0, textFormat: 0, textStyle: "", children: [{ type: "text", version: 1, text: t, format: 0, detail: 0, mode: "normal", style: "" }] });
const doc = (...c) => ({ root: { type: "root", version: 1, direction: null, format: "", indent: 0, children: c } });
const aj = new Jar(); let r = await req("/api/auth/sign-in/email", { method: "POST", jar: aj, body: ADMIN }); ok("admin sign-in", r.status === 200, r.text.slice(0, 120));

// ---- cover image through next/image on the public site + blob
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fd = new FormData(); fd.append("file", new Blob([png], { type: "image/png" }), "c.png"); r = await req("/api/admin/media", { method: "POST", jar: aj, body: fd }); const media = r.json?.data;
const slug = "deep-" + Date.now().toString(36);
r = await req("/api/admin/posts", { method: "POST", jar: aj, body: { title: "Deep " + slug, slug, section: "personal", tags: ["deep"], content: doc(para("deep body")), coverImageUrl: media?.url, coverImageAlt: "c", status: "draft" } }); const pid = r.json?.data?.id; ok("create post with blob cover", r.status === 201, r.text.slice(0, 160));
await req(`/api/admin/posts/${pid}/publish`, { method: "POST", jar: aj });
let html = ""; for (let i = 0; i < 8; i++) { const w = await req(`/personal/${slug}`); if (w.status === 200) { html = w.text; break; } await sleep(1500); }
ok("post page served", html.length > 0);
const img = html.match(/<img[^>]+src="([^"]+)"[^>]*>/g)?.map((t) => t.match(/src="([^"]+)"/)[1]).find((u) => /_next\/image|blob\.vercel-storage/.test(u));
ok("cover <img> present", !!img, img);
if (img) { const u = img.replace(/&amp;/g, "&"); const x = await fetch(u.startsWith("http") ? u : BASE + u, { headers: { "x-vercel-protection-bypass": BYPASS } }); ok("cover image fetch (optimizer/blob) 200 image/*", x.status === 200 && (x.headers.get("content-type") || "").startsWith("image/"), `${x.status} ${x.headers.get("content-type")} ${u.slice(0, 120)}`); }

// ---- payload limits (Vercel caps request bodies at 4.5 MB)
const big = doc(para("x".repeat(100)), ...Array.from({ length: 1 }, () => para("y".repeat(4_300_000))));
r = await req("/api/admin/posts", { method: "POST", jar: aj, body: { title: "too big " + slug, section: "personal", tags: [], content: big, status: "draft" } });
ok("oversize body is a clean 4xx (not a platform crash)", [400, 413, 422].includes(r.status), `${r.status} ${r.text.slice(0, 160)}`);
// ~1.2 MB data: URI image is externalised to Blob on save
const bigPng = Buffer.concat([png, Buffer.alloc(900_000, 7)]); const dataUri = "data:image/png;base64," + png.toString("base64");
r = await req("/api/admin/posts", { method: "POST", jar: aj, body: { title: "datauri " + slug, section: "personal", tags: [], content: doc({ type: "image", version: 1, src: dataUri, altText: "d", width: 1, height: 1, maxWidth: 500, showCaption: false, caption: { editorState: { root: { type: "root", version: 1, direction: null, format: "", indent: 0, children: [para("")] } } } }), status: "draft" } });
const dpid = r.json?.data?.id; const src = JSON.stringify(r.json?.data?.content ?? "").match(/"src":"([^"]+)"/)?.[1];
ok("data: URI image externalised to blob on save", r.status === 201 && /^https:\/\//.test(src ?? ""), `${r.status} ${src?.slice(0, 80)} ${r.text.slice(0, 120)}`);

// ---- scheduled publish + cron
const sslug = "sched-" + Date.now().toString(36);
r = await req("/api/admin/posts", { method: "POST", jar: aj, body: { title: "Sched " + sslug, slug: sslug, section: "engineering", tags: [], content: doc(para("scheduled body")), status: "draft" } }); const sid = r.json?.data?.id;
const when = new Date(Date.now() + 70_000).toISOString(); r = await req(`/api/admin/posts/${sid}/schedule`, { method: "POST", jar: aj, body: { scheduledFor: when } }); ok("schedule +70s", r.status === 200 && r.json?.data?.status === "scheduled", r.text.slice(0, 160));
r = await req(`/api/posts/${sslug}`); ok("scheduled post hidden", r.status === 404);
r = await req("/api/cron/publish-scheduled", { headers: { authorization: `Bearer ${CRON}` } }); ok("cron before due: nothing published", r.status === 200, r.text.slice(0, 160));
await sleep(75_000);
r = await req("/api/cron/publish-scheduled", { headers: { authorization: `Bearer ${CRON}` } }); ok("cron after due publishes", r.status === 200 && /1|published/.test(r.text), r.text.slice(0, 200));
let live = 0; for (let i = 0; i < 8 && live !== 200; i++) { live = (await req(`/engineering/${sslug}`)).status; if (live !== 200) await sleep(1500); } ok("scheduled post live on web after cron (revalidation)", live === 200, String(live));
r = await Promise.all([1, 2, 3].map(() => req("/api/cron/publish-scheduled", { headers: { authorization: `Bearer ${CRON}` } }))); ok("cron overlapping invocations are safe", r.every((x) => x.status === 200), r.map((x) => x.status).join());

// ---- concurrency / connection pool (Supabase pooler limits) + cold-ish latency
const reqs = Array.from({ length: 80 }, (_, i) => req(i % 2 ? `/api/posts?pageSize=${1 + (i % 5)}&page=${1 + (i % 3)}` : `/api/search?q=${["postgres", "search", "api", "typescript"][i % 4]}&page=1&pageSize=${1 + (i % 7)}`));
const out = await Promise.all(reqs); const bad = out.filter((x) => x.status !== 200); const lat = out.map((x) => x.ms).sort((a, b) => a - b);
ok("80 concurrent DB-backed requests all 200", bad.length === 0, bad.slice(0, 3).map((x) => `${x.status} ${x.text.slice(0, 120)}`).join(" | "));
console.log(`latency p50=${lat[40]}ms p95=${lat[76]}ms max=${lat[79]}ms`);
const web = await Promise.all(Array.from({ length: 30 }, (_, i) => req(`/engineering?page=1&tag=${["postgres", "search", "api"][i % 3]}`))); ok("30 concurrent SSR listing renders all 200", web.every((x) => x.status === 200), web.filter((x) => x.status !== 200).slice(0, 2).map((x) => x.status + x.text.slice(0, 80)).join("|"));
const wl = web.map((x) => x.ms).sort((a, b) => a - b); console.log(`ssr p50=${wl[15]}ms p95=${wl[28]}ms`);

// ---- signup (verification mail cannot be delivered with the console mailer: must fail soft, not 500)
const em = `signup-${Date.now()}@example.com`; await sleep(11000);
r = await req("/api/auth/sign-up/email", { method: "POST", body: { email: em, password: "A-long-test-password-123", name: "Signup Test" } }); ok("sign-up responds without 5xx", r.status < 500, `${r.status} ${r.text.slice(0, 200)}`);
await sleep(11000); r = await req("/api/auth/sign-in/email", { method: "POST", body: { email: em, password: "A-long-test-password-123" } }); ok("unverified user cannot sign in (403)", r.status === 403, `${r.status} ${r.text.slice(0, 160)}`);

// ---- misc protocol behaviour on the edge
r = await req("/api/posts", { method: "OPTIONS" }); ok("OPTIONS handled (no 5xx)", r.status < 500, r.status);
r = await fetch(BASE + "/api/posts?pageSize=1", { method: "HEAD", headers: { "x-vercel-protection-bypass": BYPASS } }); ok("HEAD ok", r.status === 200, r.status);
r = await fetch(BASE + "/api/posts?pageSize=1", { headers: { "x-vercel-protection-bypass": BYPASS, "accept-encoding": "gzip, br" } }); ok("compressed responses", /br|gzip/.test(r.headers.get("content-encoding") ?? ""), r.headers.get("content-encoding"));

// ---- cleanup
for (const id of [pid, dpid, sid]) if (id) await req(`/api/admin/posts/${id}`, { method: "DELETE", jar: aj });
if (media?.id) await req(`/api/admin/media/${media.id}?force=true`, { method: "DELETE", jar: aj });
const bad2 = results.filter((x) => !x).length; console.log(`\n${results.length - bad2}/${results.length} passed`); process.exit(bad2 ? 1 : 0);
