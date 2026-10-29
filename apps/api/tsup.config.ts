import { defineConfig } from "tsup";

/**
 * Production bundle for Vercel / `node dist/index.cjs`: ONE self-contained CommonJS file (`dist/index.cjs`).
 *
 * Why this shape (measured): everything, npm dependencies included, is inlined, so the function does not depend on how
 * Vercel traces a pnpm workspace's `node_modules` (workspace packages export TypeScript source, which a runtime cannot
 * load), and cold start is ~2x faster than loading ~800 modules from disk (≈0.5 s vs ≈1 s to import). `.cjs` is CommonJS
 * regardless of any `"type": "module"` in a package.json that is or is not copied next to the file, which is what produced
 * "Cannot use import statement outside a module" in the generated service wrapper. Size ≈ 7 MB (limit: 250 MB).
 *
 * `module.exports` is the Express app itself and also `.default`, so a loader doing `require(file)`,
 * `require(file).default` or `import app from file` all get the app.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  splitting: false,
  dts: false,
  shims: true, // `import.meta.url` (direct-run check) in CommonJS
  noExternal: [/.*/],
  external: ["pg-native"], // optional native driver of `pg`, never installed
  // `module.exports = app`, plus `.default` so ESM-interop style loaders (`mod.default`) work too
  footer: { js: "module.exports = ((app) => Object.assign(app, { default: app }))(module.exports.default);" },
  tsconfig: "tsconfig.json",
});
