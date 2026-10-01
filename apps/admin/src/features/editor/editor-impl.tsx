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
  const initialState = useMemo(() => initialContent as unknown as EditorState, []); // eslint-disable-line react-hooks/exhaustive-deps
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
      const first = last.current === null;
      last.current = json;
      if (first && !touched.current) cbs.current.onBaseline(json);
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
