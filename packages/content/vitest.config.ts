import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only: the optional editor-compat test imports the real editor package (via apps/web's install).
 * Make `lexical` / `@lexical/*` imports from our test helpers resolve exactly like the editor's own imports,
 * so there is a single Lexical instance. If the editor package isn't installed this is a no-op.
 */
function editorResolve(): Plugin | null {
  let editorEntry: string;
  try {
    editorEntry = fs.realpathSync(
      path.resolve(here, "../../apps/web/node_modules/@scottjgilbert/lexical-blog-editor/build/index.js"),
    );
  } catch {
    return null;
  }
  return {
    name: "bcf-editor-resolve",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || importer.includes("node_modules")) return null;
      if (!/^(lexical|@lexical\/)/.test(source)) return null;
      return this.resolve(source, editorEntry, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [editorResolve()].filter(Boolean) as Plugin[],
  test: {
    include: ["test/**/*.test.ts"],
    server: {
      deps: {
        // The editor package ships extensionless ESM + CSS imports; let Vite transform it
        // (only used by the optional compat test).
        inline: [/lexical-blog-editor/],
      },
    },
    testTimeout: 30000,
  },
});
