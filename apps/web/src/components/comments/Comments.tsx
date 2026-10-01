"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Comment, PaginationMeta } from "@blog/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormStatus, TextAreaField } from "@/components/ui/Field";
import { useAuth } from "@/lib/auth-store";
import { getBrowserApi } from "@/lib/browser-api";
import { CommentForm } from "./CommentForm";
import { CommentItem, type ReplyItem } from "./CommentItem";
import { commentErrorMessage } from "./errors";

const PAGE_SIZE = 10;
/** Reserved before the first load so the (below-the-fold) section never grows under the reader. */
const RESERVED = "min-h-[28rem]";

type Item = Omit<Comment, "replies"> & { pending?: boolean; replies: ReplyItem[] };
type Phase = "idle" | "loading" | "ready" | "error";
type DialogState = { kind: "delete" | "report"; id: string; topId: string | null } | null;

let tempCounter = 0;

/**
 * Comments island. The thread is fetched on the client (it is viewer-specific: canEdit/canDelete, and always fresh),
 * and this module is itself only downloaded when the section approaches the viewport (see CommentsLazy), into a box
 * of reserved height. Posting, editing, deleting are
 * optimistic and roll back on failure.
 */
export function Comments({ slug }: { slug: string }) {
  const pathname = usePathname();
  const auth = useAuth();
  const me = auth.me;
  const canComment = auth.status === "authenticated" && auth.me.emailVerified;

  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const started = useRef(false);

  const load = useCallback(
    async (page: number) => {
      try {
        const res = await (await getBrowserApi()).comments(slug, { page, pageSize: PAGE_SIZE }, { cache: "no-store" });
        setItems((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          return page === 1 ? res.data : [...prev, ...res.data.filter((c) => !seen.has(c.id))];
        });
        setMeta(res.meta);
        setPhase("ready");
      } catch {
        setPhase("error");
        setNotice({ kind: "error", text: "Couldn't load comments." });
      }
    },
    [slug],
  );

  // Mounted by CommentsLazy only once the section is near the viewport: fetch right away.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(1);
  }, [load]);

  function retry() {
    setNotice(null);
    setPhase("loading");
    void load(1);
  }

  async function loadMore() {
    if (!meta) return;
    setLoadingMore(true);
    await load(meta.page + 1);
    setLoadingMore(false);
  }

  // ----- mutations (optimistic) ---------------------------------------------------------------------------------
  async function create(body: string, parentId: string | null) {
    if (!me) throw new Error("Please sign in to comment.");
    const tempId = `tmp-${++tempCounter}`;
    const now = new Date().toISOString();
    const temp: Item = {
      id: tempId,
      parentId,
      body,
      status: "visible",
      author: { name: me.name, image: me.image },
      createdAt: now,
      editedAt: null,
      canEdit: false,
      canDelete: false,
      replies: [],
      pending: true,
    };
    setNotice(null);
    setItems((prev) =>
      parentId ? prev.map((c) => (c.id === parentId ? { ...c, replies: [...c.replies, temp] } : c)) : [temp, ...prev],
    );
    try {
      const created = await (await getBrowserApi()).createComment(slug, { body, parentId: parentId ?? undefined });
      setItems((prev) =>
        parentId
          ? prev.map((c) => (c.id === parentId ? { ...c, replies: c.replies.map((r) => (r.id === tempId ? created : r)) } : c))
          : prev.map((c) => (c.id === tempId ? created : c)),
      );
      setMeta((m) => (m && !parentId ? { ...m, total: m.total + 1 } : m));
      setNotice({ kind: "success", text: parentId ? "Reply posted." : "Comment posted." });
    } catch (err) {
      setItems((prev) =>
        parentId
          ? prev.map((c) => (c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== tempId) } : c))
          : prev.filter((c) => c.id !== tempId),
      );
      throw new Error(commentErrorMessage(err, "post"));
    }
  }

  async function edit(id: string, topId: string | null, body: string) {
    const patch = (fn: (c: ReplyItem) => ReplyItem) =>
      setItems((prev) =>
        prev.map((c) => {
          if (topId === null) return c.id === id ? { ...c, ...fn(c) } : c;
          return c.id === topId ? { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) } : c;
        }),
      );
    let previous: ReplyItem | undefined;
    patch((c) => {
      previous = c;
      return { ...c, body, editedAt: new Date().toISOString() };
    });
    try {
      const updated = await (await getBrowserApi()).updateComment(id, { body });
      patch((c) => ({ ...c, ...updated }));
      setNotice({ kind: "success", text: "Comment updated." });
    } catch (err) {
      if (previous) patch(() => previous!);
      throw new Error(commentErrorMessage(err, "edit"));
    }
  }

  async function remove(id: string, topId: string | null) {
    const snapshot = items;
    setItems((prev) => {
      if (topId) return prev.map((c) => (c.id === topId ? { ...c, replies: c.replies.filter((r) => r.id !== id) } : c));
      // A top-level comment with replies stays as "[deleted]"; without replies it disappears.
      return prev.flatMap((c) =>
        c.id !== id ? [c] : c.replies.length > 0 ? [{ ...c, body: "[deleted]", status: "deleted" as const, canEdit: false, canDelete: false }] : [],
      );
    });
    try {
      await (await getBrowserApi()).deleteComment(id);
      if (!topId) setMeta((m) => (m ? { ...m, total: Math.max(0, m.total - 1) } : m));
      setNotice({ kind: "success", text: "Comment deleted." });
    } catch (err) {
      setItems(snapshot);
      setNotice({ kind: "error", text: commentErrorMessage(err, "delete") });
    }
  }

  const redirectNext = encodeURIComponent(`${pathname}#comments`);
  const total = meta?.total ?? null;
  const hasMore = meta ? meta.page < meta.totalPages : false;

  return (
    <section
      id="comments"
      aria-labelledby="comments-title"
      className={phase === "ready" ? undefined : RESERVED}
    >
      <h2 id="comments-title" className="text-2xl">
        Comments{total !== null && total > 0 ? <span className="ml-2 font-accent text-lg text-muted">({total})</span> : null}
      </h2>

      {/* Compose area: same reserved height for every viewer state. */}
      <div className="mt-5 min-h-44 rounded-card border border-border bg-surface p-4 sm:p-5">
        {auth.status === "unknown" || phase === "idle" ? (
          <div aria-hidden className="grid gap-3">
            <div className="h-5 w-32 rounded bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-24 rounded-control bg-surface-2 motion-safe:animate-pulse" />
          </div>
        ) : auth.status === "anonymous" ? (
          <div className="flex min-h-32 flex-col items-start justify-center gap-3">
            <p className="text-lg font-bold">Join the conversation</p>
            <p className="text-muted">Sign in with a verified email address to leave a comment.</p>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/login?next=${redirectNext}`}
                className="inline-flex min-h-11 items-center rounded-control bg-accent px-5 text-sm font-bold text-accent-fg hover:bg-accent-hover"
              >
                Sign in
              </Link>
              <Link
                href={`/signup?next=${redirectNext}`}
                className="inline-flex min-h-11 items-center rounded-control border border-border-strong px-5 text-sm font-bold hover:bg-surface-2"
              >
                Create an account
              </Link>
            </div>
          </div>
        ) : !canComment ? (
          <div className="flex min-h-32 flex-col items-start justify-center gap-3">
            <p className="text-lg font-bold">Verify your email to comment</p>
            <p className="text-muted">
              We sent a link to <strong className="break-all">{me?.email}</strong> when you signed up.
            </p>
            <Link
              href={`/verify-email?email=${encodeURIComponent(me?.email ?? "")}&next=${redirectNext}`}
              className="inline-flex min-h-11 items-center rounded-control border border-border-strong px-5 text-sm font-bold hover:bg-surface-2"
            >
              Resend verification email
            </Link>
          </div>
        ) : (
          <CommentForm label="Add a comment" onSubmit={(body) => create(body, null)} />
        )}
      </div>

      <FormStatus kind={notice?.kind === "error" ? "error" : "success"} className="mt-3">
        {notice?.text}
      </FormStatus>

      <div className="mt-6">
        {phase === "idle" || phase === "loading" ? (
          <div role="status" aria-label="Loading comments" className="grid gap-6">
            {[0, 1].map((i) => (
              <div key={i} aria-hidden className="flex gap-4">
                <div className="size-10 shrink-0 rounded-full bg-surface-2 motion-safe:animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 rounded bg-surface-2 motion-safe:animate-pulse" />
                  <div className="h-4 w-full rounded bg-surface-2 motion-safe:animate-pulse" />
                  <div className="h-4 w-2/3 rounded bg-surface-2 motion-safe:animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : phase === "error" ? (
          <div className="rounded-card border border-border p-5">
            <p className="font-semibold">Comments are unavailable right now.</p>
            <Button variant="secondary" className="mt-3" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong p-6 text-center text-muted">
            No comments yet. {canComment ? "Be the first to share your thoughts." : "Sign in to start the conversation."}
          </p>
        ) : (
          <>
            <ul className="grid gap-8">
              {items.map((c) => (
                <li key={c.id}>
                  <CommentItem
                    comment={c}
                    canInteract={canComment}
                    onReply={(body) => create(body, c.id)}
                    onEdit={(body) => edit(c.id, null, body)}
                    onDelete={() => setDialog({ kind: "delete", id: c.id, topId: null })}
                    onReport={() => setDialog({ kind: "report", id: c.id, topId: null })}
                  >
                    {c.replies.length > 0 && (
                      <ul aria-label={`Replies to ${c.author.name}`} className="mt-4 grid gap-5 border-l-2 border-border pl-4 sm:pl-5">
                        {c.replies.map((r) => (
                          <li key={r.id}>
                            <CommentItem
                              comment={r}
                              isReply
                              canInteract={canComment}
                              onReply={(body) => create(body, c.id)}
                              onEdit={(body) => edit(r.id, c.id, body)}
                              onDelete={() => setDialog({ kind: "delete", id: r.id, topId: c.id })}
                              onReport={() => setDialog({ kind: "report", id: r.id, topId: c.id })}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CommentItem>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <Button variant="secondary" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more comments"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialogs
        state={dialog}
        onClose={() => setDialog(null)}
        onDelete={async (d) => {
          setDialog(null);
          await remove(d.id, d.topId);
        }}
        onReported={() => setNotice({ kind: "success", text: "Thanks. We'll take a look at that comment." })}
      />
    </section>
  );
}

function ConfirmDialogs({
  state,
  onClose,
  onDelete,
  onReported,
}: {
  state: DialogState;
  onClose: () => void;
  onDelete: (d: NonNullable<DialogState>) => Promise<void>;
  onReported: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason("");
    setError(null);
    setBusy(false);
    onClose();
  }

  async function report(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    const text = reason.trim();
    if (text.length < 3) return setError("Please give a reason of at least 3 characters.");
    setBusy(true);
    setError(null);
    try {
      await (await getBrowserApi()).reportComment(state.id, { reason: text });
      onReported();
      close();
    } catch (err) {
      setBusy(false);
      setError(commentErrorMessage(err, "report"));
    }
  }

  return (
    <>
      <Dialog
        open={state?.kind === "delete"}
        onClose={close}
        title="Delete this comment?"
        description="This can't be undone."
      >
        <div className="flex flex-wrap gap-3">
          <Button variant="danger" onClick={() => state && void onDelete(state)}>
            Delete comment
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={state?.kind === "report"}
        onClose={close}
        title="Report this comment"
        description="Tell us what's wrong. A moderator will review it."
      >
        <form onSubmit={report} className="grid gap-4" noValidate>
          <TextAreaField
            id="report-reason"
            label="Reason"
            rows={4}
            maxLength={500}
            required
            data-autofocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={error}
            hint={`${500 - reason.length} characters left`}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? "Sending…" : "Send report"}
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
