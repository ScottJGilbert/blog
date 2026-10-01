/**
 * Optional dev-only harness: runs the REAL @scottjgilbert/lexical-blog-editor headless export in Node
 * (with jsdom) so tests can compare our pure-string renderer with the package's own HTML.
 * Everything resolves through apps/web's installed copy; if unavailable `loadEditorKit()` returns null
 * and the dependent tests skip.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface EditorKit {
  /** absolute path of the installed editor package */
  dir: string;
  L: any; // lexical
  m: Record<string, any>; // module bag
  create(): any; // headless editor
  /** run `build` inside editor.update on a fresh editor; returns serialized JSON + package HTML */
  run(build: (root: any) => void): { json: { root: Record<string, any> }; html: string };
  /** import serialized JSON into the real editor and return its HTML (validates our fixtures are loadable) */
  htmlFromJson(json: unknown): string;
}

let cached: EditorKit | null | undefined;

export async function loadEditorKit(): Promise<EditorKit | null> {
  if (cached !== undefined) return cached;
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const editorDir = fs.realpathSync(
      path.resolve(here, "../../../../apps/web/node_modules/@scottjgilbert/lexical-blog-editor"),
    );
    const req = createRequire(path.join(editorDir, "package.json"));
    const { JSDOM } = req("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const g = globalThis as Record<string, unknown>;
    g.window = dom.window;
    g.document = dom.window.document;
    for (const k of ["DOMParser", "Node", "HTMLElement", "Element", "getComputedStyle", "MutationObserver"]) {
      try {
        g[k] = (dom.window as unknown as Record<string, unknown>)[k];
      } catch {
        /* read-only globals: ignore */
      }
    }
    const imp = (id: string) => import(/* @vite-ignore */ id);
    const L = await imp("lexical");
    const { createHeadlessEditor } = await imp("@lexical/headless");
    const { $generateHtmlFromNodes } = await imp("@lexical/html");
    const m: Record<string, any> = {
      richText: await imp("@lexical/rich-text"),
      list: await imp("@lexical/list"),
      link: await imp("@lexical/link"),
      table: await imp("@lexical/table"),
      hashtag: await imp("@lexical/hashtag"),
      mark: await imp("@lexical/mark"),
      overflow: await imp("@lexical/overflow"),
      extension: await imp("@lexical/extension"),
    };
    const nd = (p: string) => import(/* @vite-ignore */ path.join(editorDir, "build", p));
    const nodes = (await nd("nodes/PlaygroundNodes/ServerPlaygroundNodes.js")).default;
    const theme = (await nd("themes/ViewerTheme.js")).default;
    const { buildHTMLConfig } = await nd("buildHTMLConfig.js");
    m.image = await nd("nodes/ImageNode.js");
    m.equation = await nd("nodes/EquationNode.js");
    m.emoji = await nd("nodes/EmojiNode.js");
    m.mention = await nd("nodes/MentionNode.js");
    m.keyword = await nd("nodes/KeywordNode.js");
    m.special = await nd("nodes/SpecialTextNode.js");
    m.layoutC = await nd("nodes/LayoutContainerNode.js");
    m.layoutI = await nd("nodes/LayoutItemNode.js");
    m.tweet = await nd("nodes/TweetNode/ServerTweetNode.js");
    m.youtube = await nd("nodes/YouTubeNode/ServerYouTubeNode.js");
    m.figma = await nd("nodes/FigmaNode/ServerFigmaNode.js");
    m.dateTime = await nd("nodes/DateTimeNode/DateTimeNode.js");
    m.code = await nd("nodes/CodeNode/CodeNode.js");
    m.codeHl = await nd("nodes/CodeNode/CodeHighlightNode.js");
    m.collC = await nd("plugins/CollapsiblePlugin/CollapsibleContainerNode.js");
    m.collT = await nd("plugins/CollapsiblePlugin/CollapsibleTitleNode.js");
    m.collB = await nd("plugins/CollapsiblePlugin/CollapsibleContentNode.js");

    const create = () =>
      createHeadlessEditor({
        namespace: "ViewerEditor",
        nodes: [...nodes],
        onError(e: Error) {
          throw e;
        },
        html: buildHTMLConfig(),
        theme,
      });

    const kit: EditorKit = {
      dir: editorDir,
      L,
      m,
      create,
      run(build) {
        const editor = create();
        editor.update(
          () => {
            const root = L.$getRoot();
            root.clear();
            build(root);
          },
          { discrete: true },
        );
        const json = editor.getEditorState().toJSON();
        let html = "";
        editor.getEditorState().read(() => {
          html = $generateHtmlFromNodes(editor);
        });
        return { json, html };
      },
      htmlFromJson(json) {
        const editor = create();
        editor.setEditorState(editor.parseEditorState(JSON.stringify(json)));
        let html = "";
        editor.getEditorState().read(() => {
          html = $generateHtmlFromNodes(editor);
        });
        return html;
      },
    };
    cached = kit;
    return kit;
  } catch (err) {
    console.warn("[content tests] editor kit unavailable:", (err as Error).message);
    cached = null;
    return null;
  }
}
