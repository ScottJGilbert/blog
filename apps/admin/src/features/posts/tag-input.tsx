"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import useSWR from "swr";
import { LuX } from "react-icons/lu";
import { api } from "@/lib/api";
import { cn } from "@/components/ui/cn";

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;

/**
 * Tag chips + ARIA 1.2 combobox (editable, list autocomplete). Suggestions come from existing tags (`GET /tags`).
 * Enter / comma adds the typed value (or the highlighted suggestion); Backspace on empty input removes the last chip.
 */
export function TagInput({
  value,
  onChange,
  error,
  label = "Tags",
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  error?: string | null;
  label?: string;
}) {
  const uid = useId();
  const inputId = `${uid}-in`;
  const listId = `${uid}-list`;
  const hintId = `${uid}-hint`;
  const errId = `${uid}-err`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [note, setNote] = useState("");

  const { data: tags } = useSWR(["tags"], () => api.tags());

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    const have = new Set(value.map((v) => v.toLowerCase()));
    return (tags ?? [])
      .filter((t) => !have.has(t.name.toLowerCase()) && (q === "" || t.name.toLowerCase().includes(q) || t.slug.includes(q)))
      .slice(0, 8);
  }, [tags, text, value]);

  function add(raw: string) {
    const name = raw.trim().replace(/\s+/g, " ").replace(/^#/, "");
    if (!name) return false;
    if (name.length > MAX_TAG_LENGTH) {
      setNote(`Tags can be at most ${MAX_TAG_LENGTH} characters.`);
      return false;
    }
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) {
      setText("");
      setNote(`“${name}” is already added.`);
      return true;
    }
    if (value.length >= MAX_TAGS) {
      setNote(`You can add up to ${MAX_TAGS} tags.`);
      return false;
    }
    onChange([...value, name]);
    setText("");
    setActive(-1);
    setNote(`Added tag ${name}.`);
    return true;
  }

  function remove(i: number) {
    const name = value[i];
    onChange(value.filter((_, idx) => idx !== i));
    setNote(`Removed tag ${name}.`);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (suggestions.length ? (a + 1) % suggestions.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (suggestions.length ? (a <= 0 ? suggestions.length - 1 : a - 1) : -1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && suggestions[active]) {
        e.preventDefault();
        add(suggestions[active]!.name);
      } else if (text.trim()) {
        e.preventDefault();
        add(text);
      }
    } else if (e.key === "," || e.key === "Tab") {
      if (text.trim()) {
        if (e.key === ",") e.preventDefault();
        if (e.key === "," || e.key === "Tab") add(text);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      remove(value.length - 1);
    }
  }

  const expanded = open && suggestions.length > 0;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-ctl border bg-panel px-2 py-1.5 focus-within:border-brand focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-brand",
          error ? "border-danger" : "border-edge-strong",
        )}
      >
        {value.map((t, i) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1 text-sm font-medium text-brand">
            {t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => remove(i)}
              className="grid size-5 place-items-center rounded-full hover:bg-brand/15 pointer-coarse:size-7"
            >
              <LuX aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}
        <div className="relative min-w-28 flex-1">
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
            aria-describedby={`${hintId}${error ? ` ${errId}` : ""}`}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            value={text}
            placeholder={value.length ? "" : "Add a tag…"}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(-1);
              setNote("");
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              if (text.trim()) add(text);
            }}
            onKeyDown={onKeyDown}
            className="min-h-7 w-full border-0 bg-transparent p-0 text-sm outline-none focus:ring-0 focus-visible:outline-none"
          />
          <ul
            id={listId}
            role="listbox"
            aria-label="Tag suggestions"
            hidden={!expanded}
            className="absolute left-0 top-full z-20 mt-2 max-h-56 w-64 max-w-[80vw] overflow-auto rounded-lg border border-edge bg-panel p-1 shadow-pop"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.slug}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown (not click) so the input does not blur first
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s.name);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm",
                  i === active ? "bg-brand-soft text-brand" : "hover:bg-panel-2",
                )}
              >
                <span className="truncate">{s.name}</span>
                <span className="text-xs text-muted">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p id={hintId} className="text-[0.8125rem] text-muted">
        Press Enter or comma to add. Up to {MAX_TAGS} tags.
      </p>
      {error ? (
        <p id={errId} className="text-[0.8125rem] font-medium text-danger">
          {error}
        </p>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {note}
      </span>
    </div>
  );
}
