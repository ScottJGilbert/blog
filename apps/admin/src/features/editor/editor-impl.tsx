"use client";

/**
 * Thin wrapper around `@scottjgilbert/lexical-blog-editor` (used as-is). This module is only ever loaded through
 * `next/dynamic` with `ssr: false` (see rich-editor.tsx) so Lexical stays out of the main bundle.
 *
 * What the package actually accepts (verified in its source + Lexical 0.40):
 *  - `initialState` is passed to `defineExtension({ $initialEditorState })`, which takes an EditorState, a string
 *    or a plain serialized-state object and runs `editor.parseEditorState()`. We pass the plain object (cast, the
 *    package types only say `EditorState`). It MUST be referentially stable: the package re-creates the editor
 *    when the prop identity changes (`useMemo([initialState])`). Remount via `key` to load different content.
 *  - `onChange(editorState)` fires for every update, including selection changes. We serialise with
 *    `editorState.toJSON()` (debounced) and only report when the JSON really changed.
 *  - Without `initialState` the package pre-fills a "Welcome" heading, so we ALWAYS pass one.
 */
import { Editor, type EditorState } from "@scottjgilbert/lexical-blog-editor";
import "@scottjgilbert/lexical-blog-editor/styles/ViewerTheme.css";
import { useEffect, useMemo, useRef } from "react";
import type { LexicalContent } from "@blog/shared";

/** Node types that cannot sit directly under Lexical's root (text-like nodes, line breaks) or that are inline runs. */
const INLINE_TYPES = new Set([
  "text",
  "linebreak",
  "tab",
  "specialText",
  "hashtag",
  "keyword",
  "mention",
  "emoji",
  "code-highlight",
  "overflow",
  "link",
  "autolink",
  "mark",
  "datetime",
]);

/**
 * Lexical's `parseEditorState` throws ("Only element or decorator nodes can be inserted to the root node") when stored
 * content has inline/text nodes straight under the root, which would take the whole editor page down. Such documents
 * exist (the API accepts them and the public renderer shows them), so group each inline run into a paragraph first.
 */
export function normalizeRoot(content: LexicalContent): LexicalContent {
  const root = (content as { root?: { children?: unknown[] } }).root;
  if (!root || !Array.isArray(root.children)) return content;
  const isInline = (n: unknown) => typeof n === "object" && n !== null && INLINE_TYPES.has((n as { type?: string }).type ?? "");
  if (!root.children.some(isInline)) return content;
  const children: unknown[] = [];
  let run: unknown[] = [];
  const flush = () => {
    if (run.length === 0) return;
    children.push({ type: "paragraph", version: 1, format: "", indent: 0, direction: "ltr", textFormat: 0, textStyle: "", children: run });
    run = [];
  };
  for (const child of root.children) {
    if (isInline(child)) run.push(child);
    else {
      flush();
      children.push(child);
    }
  }
  flush();
  return { ...content, root: { ...root, children } } as LexicalContent;
}

export interface RichEditorProps {
  initialContent: LexicalContent;
  /** serialised JSON string of the current document (only when it differs from the previous report) */
  onChange: (json: string) => void;
  /** first snapshot after load, before the user touched anything (normalised form of `initialContent`) */
  onBaseline: (json: string) => void;
  placeholder?: string;
  /** set by the editor: call to serialise + report any pending (debounced) change immediately (e.g. right before saving) */
  flushRef?: { current: (() => void) | null };
}

export default function EditorImpl({ initialContent, onChange, onBaseline, placeholder, flushRef }: RichEditorProps) {
  // Stable identity for the lifetime of this mount (see header comment).
  const initialState = useMemo(() => normalizeRoot(initialContent) as unknown as EditorState, []); // eslint-disable-line react-hooks/exhaustive-deps
  const touched = useRef(false);
  const last = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const cbs = useRef({ onChange, onBaseline });
  useEffect(() => {
    cbs.current = { onChange, onBaseline };
  });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const latest = useRef<EditorState | null>(null);
  const report = useMemo(
    () => () => {
      const state = latest.current;
      if (!state) return;
      latest.current = null;
      const json = JSON.stringify(state.toJSON());
      if (json === last.current) return;
      last.current = json;
      // Until the user interacts, every report is the editor normalising what it loaded (code blocks are re-tokenised
      // and styled a moment after mount): that is the new baseline, not an unsaved edit.
      if (!touched.current) cbs.current.onBaseline(json);
      else cbs.current.onChange(json);
    },
    [],
  );
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => {
      window.clearTimeout(timer.current);
      report();
    };
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, report]);

  const handle = useMemo(
    () => (state: EditorState) => {
      latest.current = state;
      window.clearTimeout(timer.current);
      // first report immediately (baseline), later ones debounced to avoid serialising on every keystroke
      const delay = last.current === null ? 0 : 250;
      timer.current = window.setTimeout(report, delay);
    },
    [report],
  );

  // The package's contenteditable has no accessible name; name it without touching the package.
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const name = () => {
      const el = host.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"], [contenteditable="true"]');
      if (el && !el.getAttribute("aria-label")) el.setAttribute("aria-label", placeholder ?? "Rich text content");
      return Boolean(el);
    };
    if (name()) return;
    const mo = new MutationObserver(() => name() && mo.disconnect());
    mo.observe(host, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [placeholder]);

  const mark = () => {
    touched.current = true;
  };

  return (
    <div
      ref={hostRef}
      className="editor-host"
      onKeyDownCapture={mark}
      onPointerDownCapture={mark}
      onPasteCapture={mark}
      onDropCapture={mark}
      onBeforeInputCapture={mark}
    >
      <Editor initialState={initialState} onChange={handle} placeholder={placeholder ?? "Start writing…"} />
    </div>
  );
}
