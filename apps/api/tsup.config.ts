import { defineConfig } from "tsup";

/**
 * Production bundle for Vercel / `node dist/index.js`.
 * Workspace packages (@blog/*) export TypeScript source, so they are inlined; npm deps stay external.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  noExternal: [/^@blog\//],
  tsconfig: "tsconfig.json",
});
