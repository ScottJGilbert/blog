import type { LexicalContent } from "@blog/shared";

/** An empty Lexical document (one empty paragraph); identical in shape to `emptyContent()` of @blog/content. */
export function emptyContentDoc(): LexicalContent {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        { type: "paragraph", version: 1, children: [], direction: null, format: "", indent: 0, textFormat: 0, textStyle: "" },
      ],
    },
  };
}
