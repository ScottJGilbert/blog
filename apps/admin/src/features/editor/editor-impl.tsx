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
}

export default function EditorImpl({ initialContent, onChange, onBaseline, placeholder }: RichEditorProps) {
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

  const handle = useMemo(
    () => (state: EditorState) => {
      window.clearTimeout(timer.current);
      // first report immediately (baseline), later ones debounced to avoid serialising on every keystroke
      const delay = last.current === null ? 0 : 250;
      timer.current = window.setTimeout(() => {
        const json = JSON.stringify(state.toJSON());
        if (json === last.current) return;
        const first = last.current === null;
        last.current = json;
        if (first && !touched.current) cbs.current.onBaseline(json);
        else cbs.current.onChange(json);
      }, delay);
    },
    [],
  );

  const mark = () => {
    touched.current = true;
  };

  return (
    <div
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
