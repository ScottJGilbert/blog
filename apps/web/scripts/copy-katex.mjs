// Publishes KaTeX's stylesheet + woff2 fonts as plain static files under public/katex/<version>/ so a post page can
// link them ONLY when its HTML contains equations. (Importing the CSS from a component makes the bundler attach it to
// every post route, equations or not.) woff/ttf fallbacks are dropped: every browser that runs this site has woff2.
// Runs before `next build` / `next dev` (see package.json). Output is git-ignored.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("katex/dist/katex.min.css"));
const { version } = JSON.parse(readFileSync(join(dist, "..", "package.json"), "utf8"));
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "katex");
const out = join(root, version);

rmSync(root, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });

const css = readFileSync(join(dist, "katex.min.css"), "utf8")
  .replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\)/g, "")
  .replace(/,url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, "");
writeFileSync(join(out, "katex.css"), css);
for (const f of readdirSync(join(dist, "fonts"))) {
  if (f.endsWith(".woff2")) cpSync(join(dist, "fonts", f), join(out, "fonts", f));
}
console.log(`[katex] public/katex/${version}: ${css.length} bytes of CSS`);
