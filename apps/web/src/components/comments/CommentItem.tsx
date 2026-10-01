"use client";

import { useEffect, useRef, useState } from "react";
import type { CommentReply } from "@blog/shared";
import { COMMENT_EDIT_WINDOW_MINUTES } from "@/lib/constants";
import { clsx } from "clsx";
import { LuCornerDownRight, LuFlag, LuPencil, LuTrash2 } from "react-icons/lu";
import { formatDateTime, relativeTime } from "@/lib/format";
import { CommentForm } from "./CommentForm";

export type ReplyItem = CommentReply & { pending?: boolean };

const action =
  "inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-semibold text-muted transition-colors hover:text-accent disabled:pointer-events-none disabled:opacity-60";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function withinEditWindow(c: Pick<CommentReply, "createdAt">, now = Date.now()) {
  return now - new Date(c.createdAt).getTime() < COMMENT_EDIT_WINDOW_MINUTES * 60_000;
}

/**
 * One comment (top-level or reply). Presentational + local edit/reply form state; all mutations are delegated to the
 * parent (which owns the optimistic list state).
 */
export function CommentItem({
  comment,
  isReply = false,
  canInteract,
  onReply,
  onEdit,
  onDelete,
  onReport,
  children,
}: {
  comment: ReplyItem;
  isReply?: boolean;
  /** viewer is signed in with a verified email */
  canInteract: boolean;
  onReply?: (body: string) => Promise<void>;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => void;
  onReport: () => void;
  children?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"view" | "reply" | "edit">("view");
  // Closing the reply/edit form unmounts the control that opened it: hand focus back to that button (or the comment).
  const articleRef = useRef<HTMLElement>(null);
  const replyRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<"reply" | "edit" | null>(null);
  const open = (next: "reply" | "edit") => {
    returnTo.current = next;
    setMode(next);
  };
  useEffect(() => {
    if (mode !== "view" || !returnTo.current) return;
    const target = returnTo.current === "reply" ? replyRef.current : editRef.current;
    returnTo.current = null;
    (target ?? articleRef.current)?.focus();
  }, [mode]);
  const deleted = comment.status === "deleted";
  const pending = comment.pending === true;
  const editable = comment.canEdit && !pending && !deleted && withinEditWindow(comment);

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      aria-label={`Comment by ${comment.author.name}`}
      aria-busy={pending || undefined}
      id={pending ? undefined : `comment-${comment.id}`}
      className={clsx("flex gap-3 outline-none sm:gap-4", pending && "opacity-70")}
    >
      <span
        aria-hidden
        className={clsx(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-soft-fg",
          isReply ? "size-8 text-xs" : "size-10 text-sm",
        )}
      >
        {initials(comment.author.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-bold text-fg">{comment.author.name}</span>
          <time dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)} className="text-muted">
            {pending ? "Posting…" : relativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && !deleted && <span className="text-muted">(edited)</span>}
        </p>

        {mode === "edit" ? (
          <div className="mt-2">
            <CommentForm
              label="Edit your comment"
              submitLabel="Save changes"
              initialValue={comment.body}
              autoFocus
              rows={3}
              onSubmit={async (body) => {
                await onEdit(body);
                setMode("view");
              }}
              onCancel={() => setMode("view")}
            />
          </div>
        ) : (
          <p className={clsx("mt-1 whitespace-pre-wrap text-fg", deleted && "text-muted italic")}>{comment.body}</p>
        )}

        {mode === "view" && !deleted && !pending && (
          <div className="-ml-2 flex flex-wrap items-center">
            {canInteract && onReply && (
              <button ref={replyRef} type="button" className={action} onClick={() => open("reply")}>
                <LuCornerDownRight aria-hidden className="size-4" />
                Reply<span className="sr-only"> to {comment.author.name}</span>
              </button>
            )}
            {editable && (
              <button ref={editRef} type="button" className={action} onClick={() => open("edit")}>
                <LuPencil aria-hidden className="size-4" />
                Edit<span className="sr-only"> your comment</span>
              </button>
            )}
            {comment.canDelete && (
              <button type="button" className={action} onClick={onDelete}>
                <LuTrash2 aria-hidden className="size-4" />
                Delete<span className="sr-only"> this comment</span>
              </button>
            )}
            {canInteract && !comment.canEdit && !comment.canDelete && (
              <button type="button" className={action} onClick={onReport}>
                <LuFlag aria-hidden className="size-4" />
                Report<span className="sr-only"> this comment</span>
              </button>
            )}
          </div>
        )}

        {mode === "reply" && onReply && (
          <div className="mt-3">
            <CommentForm
              label={`Reply to ${comment.author.name}`}
              submitLabel="Post reply"
              autoFocus
              rows={3}
              onSubmit={async (body) => {
                await onReply(body);
                setMode("view");
              }}
              onCancel={() => setMode("view")}
            />
          </div>
        )}

        {children}
      </div>
    </article>
  );
}
