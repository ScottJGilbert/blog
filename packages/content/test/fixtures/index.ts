import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
export { kitchenSink } from "./kitchen-sink";

const here = dirname(fileURLToPath(import.meta.url));
/** Real `editorState.toJSON()` output of @scottjgilbert/lexical-blog-editor (generated headlessly, see compat test). */
export const editorSample = JSON.parse(readFileSync(join(here, "editor-sample.json"), "utf8")) as { root: Record<string, unknown> };
