"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  LuCalendarClock,
  LuEllipsis,
  LuExternalLink,
  LuImage,
  LuSend,
  LuTrash2,
  LuTriangleAlert,
  LuUndo2,
} from "react-icons/lu";
import {
  SECTIONS,
  SlugSchema,
  UrlOrPathSchema,
  type AdminPostDetail,
  type LexicalContent,
  type Media,
  type Section,
} from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { MediaImage } from "@/features/media/media-image";
import { MediaPicker } from "@/features/media/media-picker";
import { RichEditor } from "@/features/editor/rich-editor";
import { api } from "@/lib/api";
import { publicPostUrl, withBase } from "@/lib/base-path";
import { errorMessage, fieldErrorsFromApi, type FieldErrors } from "@/lib/errors";
import { formatBytes, formatDateTime } from "@/lib/format";
import { slugify } from "@/lib/slug";
import { useUnsavedGuard } from "@/lib/unsaved-guard";
import { ScheduleDialog } from "./schedule-dialog";
import { MAX_TAGS, MAX_TAG_LENGTH, TagInput } from "./tag-input";

const AUTOSAVE_DELAY_MS = 2000;
const LARGE_CONTENT_BYTES = 1_500_000;
const SECTION_LABEL: Record<Section, string> = { personal: "Personal", engineering: "Engineering" };

export interface Draft {
  title: string;
  slug: string;
  slugTouched: boolean;
  excerpt: string;
  section: Section;
  tags: string[];
  coverImageUrl: string;
  coverImageAlt: string;
  contentStr: string;
}

export function draftFromPost(p: AdminPostDetail): Draft {
  return {
    title: p.title,
    slug: p.slug,
    slugTouched: true,
    excerpt: p.excerpt ?? "",
    section: p.section,
    tags: p.tags.map((t) => t.name),
    coverImageUrl: p.coverImageUrl ?? "",
    coverImageAlt: p.coverImageAlt ?? "",
    contentStr: JSON.stringify(p.content),
  };
}

export function snapshot(d: Draft): string {
  const { slugTouched: _ignored, ...rest } = d;
  void _ignored;
  return JSON.stringify(rest);
}

export function validateDraft(d: Draft): FieldErrors {
  const e: FieldErrors = {};
  const title = d.title.trim();
  if (!title) e.title = "Add a title.";
  else if (title.length > 200) e.title = "The title can be at most 200 characters.";
  if (d.slug.trim()) {
    const r = SlugSchema.safeParse(d.slug.trim());
    if (!r.success) e.slug = "Use lowercase letters, digits and single hyphens (max 200 characters).";
  }
  if (d.excerpt.trim().length > 500) e.excerpt = "The excerpt can be at most 500 characters.";
  if (d.tags.length > MAX_TAGS) e.tags = `Use at most ${MAX_TAGS} tags.`;
  else if (d.tags.some((t) => t.length > MAX_TAG_LENGTH)) e.tags = `Each tag can be at most ${MAX_TAG_LENGTH} characters.`;
  if (d.coverImageUrl.trim() && !UrlOrPathSchema.safeParse(d.coverImageUrl.trim()).success) {
    e.coverImageUrl = "Enter an http(s) URL or a site path.";
  }
  if (d.coverImageAlt.trim().length > 300) e.coverImageAlt = "Alt text can be at most 300 characters.";
  return e;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string }
  | { kind: "invalid" };

export function PostForm({ initial, emptyDoc }: { initial: AdminPostDetail | null; emptyDoc?: LexicalContent }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const initialDraft = useMemo<Draft>(
    () =>
      initial
        ? draftFromPost(initial)
        : {
            title: "",
            slug: "",
            slugTouched: false,
            excerpt: "",
            section: "engineering",
            tags: [],
            coverImageUrl: "",
            coverImageAlt: "",
            contentStr: JSON.stringify(emptyDoc ?? { root: { type: "root", version: 1, children: [], direction: null, format: "", indent: 0 } }),
          },
    [initial, emptyDoc],
  );

  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [post, setPost] = useState<AdminPostDetail | null>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [editorSeed, setEditorSeed] = useState<{ key: number; content: LexicalContent }>(() => ({
    key: 0,
    content: initial?.content ?? emptyDoc ?? (JSON.parse(initialDraft.contentStr) as LexicalContent),
  }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [busy, setBusy] = useState<null | "publish" | "unpublish" | "schedule" | "delete">(null);

  const draftRef = useRef(draft);
  const postRef = useRef(post);
  const savedRef = useRef<Draft>(initialDraft);
  const [savedSnap, setSavedSnap] = useState(() => snapshot(initialDraft));
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const deleted = useRef(false);
  useEffect(() => {
    draftRef.current = draft;
    postRef.current = post;
  });

  const dirty = snapshot(draft) !== savedSnap;
  const status = post?.status ?? "draft";
  const autosaveEligible = post === null || post.status === "draft";

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaveState((s) => (s.kind === "saved" || s.kind === "error" || s.kind === "invalid" ? { kind: "idle" } : s));
  }, []);

  const onTitle = (title: string) =>
    setDraft((d) => ({ ...d, title, ...(d.slugTouched ? {} : { slug: slugify(title) }) }));

  // ----- editor callbacks -------------------------------------------------------------------------------------------
  const onEditorBaseline = useCallback((json: string) => {
    setDraft((d) => {
      if (d.contentStr === json) return d;
      return { ...d, contentStr: json };
    });
    savedRef.current = { ...savedRef.current, contentStr: json };
    setSavedSnap(snapshot(savedRef.current));
  }, []);
  const onEditorChange = useCallback((json: string) => update({ contentStr: json }), [update]);

  // ----- saving -----------------------------------------------------------------------------------------------------
  const doSave = useCallback(
    async (reason: "auto" | "manual" | "publish"): Promise<AdminPostDetail | null> => {
      const d = draftRef.current;
      const errs = validateDraft(d);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        setSaveState({ kind: "invalid" });
        if (reason !== "auto") toast.error("Fix the highlighted fields before saving.");
        return null;
      }
      let content: LexicalContent;
      try {
        content = JSON.parse(d.contentStr) as LexicalContent;
      } catch {
        setFormError("The editor content could not be read. Reload the page to recover.");
        setSaveState({ kind: "error", message: "Invalid editor content" });
        return null;
      }
      setErrors({});
      setFormError(null);
      setSaveState({ kind: "saving" });
      const current = postRef.current;
      const common = {
        title: d.title.trim(),
        excerpt: d.excerpt.trim(),
        section: d.section,
        tags: d.tags,
        content,
        coverImageUrl: d.coverImageUrl.trim() || null,
        coverImageAlt: d.coverImageUrl.trim() ? d.coverImageAlt.trim() || null : null,
      };
      try {
        let res: AdminPostDetail;
        if (current) {
          res = await api.admin.posts.update(current.id, { ...common, ...(d.slug.trim() ? { slug: d.slug.trim() } : {}) });
        } else {
          res = await api.admin.posts.create({
            ...common,
            ...(d.slugTouched && d.slug.trim() ? { slug: d.slug.trim() } : {}),
            status: "draft",
          });
          // Keep the same page instance (and editor) alive; only the URL changes.
          window.history.replaceState(window.history.state, "", withBase(`/posts/${res.id}`));
        }
        postRef.current = res;
        setPost(res);
        const latest = draftRef.current;
        const slugChanged = res.slug !== d.slug.trim();
        savedRef.current = { ...d, slug: slugChanged && !d.slugTouched ? res.slug : d.slug, slugTouched: true };
        if (slugChanged && latest.slug === d.slug) setDraft((x) => ({ ...x, slug: res.slug, slugTouched: true }));
        else if (!current) setDraft((x) => ({ ...x, slugTouched: true }));
        // Server rewrote embedded data: URI images to uploaded files => adopt its content if nothing newer was typed.
        const sentHadData = d.contentStr.includes("data:image/");
        const resStr = JSON.stringify(res.content);
        if (sentHadData && resStr !== d.contentStr && latest.contentStr === d.contentStr) {
          setEditorSeed((s) => ({ key: s.key + 1, content: res.content }));
          setDraft((x) => ({ ...x, contentStr: resStr }));
          savedRef.current = { ...savedRef.current, contentStr: resStr };
          toast.info("Embedded images were uploaded to the media library.");
        }
        setSavedSnap(snapshot(savedRef.current));
        setSaveState({ kind: "saved", at: new Date() });
        globalMutate(["post", res.id], res, { revalidate: false });
        void globalMutate((k) => Array.isArray(k) && (k[0] === "posts" || k[0] === "stats"));
        if (reason === "manual") toast.success("Post saved");
        return res;
      } catch (err) {
        const fe = fieldErrorsFromApi(err);
        if (Object.keys(fe).length > 0) setErrors(fe);
        const msg = errorMessage(err);
        if (/slug/i.test(msg) && !fe.slug && (err as { status?: number }).status === 409) setErrors((x) => ({ ...x, slug: msg }));
        setFormError(msg);
        setSaveState({ kind: "error", message: msg });
        if (reason !== "auto") toast.error(msg);
        return null;
      }
    },
    [toast],
  );

  const save = useCallback(
    (reason: "auto" | "manual" | "publish") => {
      const p = chain.current.then(() => doSave(reason));
      chain.current = p.catch(() => null);
      return p;
    },
    [doSave],
  );

  const ensureSaved = useCallback(async (): Promise<AdminPostDetail | null> => {
    const d = draftRef.current;
    if (postRef.current && snapshot(d) === snapshot(savedRef.current)) return postRef.current;
    return save("publish");
  }, [save]);

  // Debounced autosave (drafts only).
  useEffect(() => {
    if (!dirty || !autosaveEligible || saveState.kind === "saving" || busy) return;
    if (Object.keys(validateDraft(draft)).length > 0) return;
    const t = window.setTimeout(() => void save("auto"), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [draft, dirty, autosaveEligible, saveState.kind, busy, save]);

  // Flush a pending draft autosave when the editor goes away (in-app navigation).
  useEffect(() => {
    return () => {
      if (deleted.current) return;
      const d = draftRef.current;
      const p = postRef.current;
      const isDirty = snapshot(d) !== snapshot(savedRef.current);
      if (isDirty && (p === null || p.status === "draft") && Object.keys(validateDraft(d)).length === 0 && d.title.trim()) {
        void doSave("auto");
      }
    };
  }, [doSave]);

  useUnsavedGuard(dirty, {
    what: "this post",
    flush: autosaveEligible
      ? async () => {
          if (Object.keys(validateDraft(draftRef.current)).length > 0) return false;
          return (await save("auto")) !== null;
        }
      : undefined,
  });

  // ----- status actions ---------------------------------------------------------------------------------------------
  async function publish() {
    setBusy("publish");
    try {
      const saved = await ensureSaved();
      if (!saved) return;
      const res = await api.admin.posts.publish(saved.id);
      setPost(res);
      postRef.current = res;
      toast.success("Post published");
      void globalMutate((k) => Array.isArray(k) && (k[0] === "posts" || k[0] === "stats"));
    } catch (err) {
      setFormError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function unpublish() {
    if (!post) return;
    const wasScheduled = post.status === "scheduled";
    const ok = await confirm({
      title: wasScheduled ? "Cancel the schedule?" : "Unpublish this post?",
      description: wasScheduled
        ? "The post goes back to draft and will not be published automatically."
        : "It will be removed from the public site and return to draft. Readers will no longer be able to open it.",
      confirmLabel: wasScheduled ? "Revert to draft" : "Unpublish",
      tone: wasScheduled ? "primary" : "danger",
    });
    if (!ok) return;
    setBusy("unpublish");
    try {
      const res = await api.admin.posts.unpublish(post.id);
      setPost(res);
      postRef.current = res;
      toast.success(wasScheduled ? "Schedule cancelled — post is a draft" : "Post unpublished");
      void globalMutate((k) => Array.isArray(k) && (k[0] === "posts" || k[0] === "stats"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function schedule(iso: string) {
    setBusy("schedule");
    try {
      const saved = await ensureSaved();
      if (!saved) throw new Error("Fix the highlighted fields before scheduling.");
      const res = await api.admin.posts.schedule(saved.id, { scheduledFor: iso });
      setPost(res);
      postRef.current = res;
      toast.success(`Scheduled for ${formatDateTime(iso)}`);
      void globalMutate((k) => Array.isArray(k) && (k[0] === "posts" || k[0] === "stats"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!post) return;
    const ok = await confirm({
      title: "Delete this post?",
      description: `“${post.title}” will be permanently deleted${post.status === "published" ? " and removed from the public site" : ""}. This cannot be undone.`,
      confirmLabel: "Delete post",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await api.admin.posts.remove(post.id);
      deleted.current = true;
      savedRef.current = draftRef.current;
      setSavedSnap(snapshot(draftRef.current));
      toast.success("Post deleted");
      void globalMutate((k) => Array.isArray(k) && (k[0] === "posts" || k[0] === "stats"));
      router.push("/posts");
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
  }

  function pickCover(m: Media) {
    update({ coverImageUrl: m.url, coverImageAlt: draftRef.current.coverImageAlt || m.alt || "" });
  }

  // ----- derived UI -------------------------------------------------------------------------------------------------
  const contentBytes = draft.contentStr.length;
  const large = contentBytes > LARGE_CONTENT_BYTES;
  const hasEmbeddedImages = useMemo(() => draft.contentStr.includes("data:image/"), [draft.contentStr]);

  const saveText = (() => {
    if (saveState.kind === "saving") return "Saving…";
    if (saveState.kind === "error") return `Save failed: ${saveState.message}`;
    if (saveState.kind === "invalid") return "Not saved — fix the highlighted fields";
    if (dirty) {
      if (!autosaveEligible) return "Unsaved changes";
      return draft.title.trim() ? "Unsaved changes — autosaving shortly…" : "Unsaved changes — add a title to save";
    }
    if (saveState.kind === "saved") return `Saved at ${saveState.at.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`;
    return post ? "All changes saved" : "Not saved yet";
  })();
  const saveTone =
    saveState.kind === "error" || saveState.kind === "invalid" ? "text-danger" : dirty || saveState.kind === "saving" ? "text-warn" : "text-muted";

  const publicUrl = post && post.status === "published" ? publicPostUrl(post.section, post.slug) : null;
  const headerTitle = post?.title || draft.title.trim() || "New post";

  return (
    <>
      <PageHeader
        title={headerTitle}
        titleSuffix={post ? <StatusBadge status={post.status} /> : <StatusBadge status="draft" label="New draft" />}
        crumbs={[{ label: "Posts", href: "/posts" }, { label: post ? "Edit" : "New post" }]}
      />

      <div className="sticky top-14 z-20 -mx-4 mb-4 border-b border-edge bg-canvas/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p role="status" aria-live="polite" className={cn("min-h-6 text-sm font-medium", saveTone)}>
            {saveText}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {publicUrl ? (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-ctl px-2 text-sm font-medium text-brand hover:underline"
              >
                <LuExternalLink aria-hidden className="size-4" />
                View on site<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            <Button onClick={() => void save("manual")} loading={saveState.kind === "saving"} disabled={(!dirty && post !== null) || !!busy}>
              {status === "draft" || !post ? "Save draft" : "Save changes"}
            </Button>
            {status !== "published" ? (
              <>
                {status === "scheduled" ? (
                  <Button onClick={unpublish} loading={busy === "unpublish"} disabled={!!busy} icon={<LuUndo2 aria-hidden className="size-4" />}>
                    Cancel schedule
                  </Button>
                ) : null}
                <Button onClick={() => setScheduleOpen(true)} disabled={!!busy} icon={<LuCalendarClock aria-hidden className="size-4" />}>
                  {status === "scheduled" ? "Reschedule" : "Schedule…"}
                </Button>
                <Button variant="primary" onClick={publish} loading={busy === "publish"} disabled={!!busy} icon={<LuSend aria-hidden className="size-4" />}>
                  Publish
                </Button>
              </>
            ) : (
              <Button onClick={unpublish} loading={busy === "unpublish"} disabled={!!busy}>
                Unpublish
              </Button>
            )}
            {post ? (
              <DropdownMenu
                label="More post actions"
                triggerClassName="grid size-10 place-items-center rounded-ctl text-muted hover:bg-panel-2 hover:text-ink pointer-coarse:size-11"
                trigger={<LuEllipsis aria-hidden className="size-5" />}
                items={[{ id: "delete", label: "Delete post…", icon: <LuTrash2 className="size-4" />, danger: true, onSelect: remove }]}
              />
            ) : null}
          </div>
        </div>
      </div>

      {formError ? (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-ctl border border-danger/50 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
          <LuTriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="xl:col-start-1 xl:row-start-1">
          <Input
            label="Title"
            required
            value={draft.title}
            onChange={(e) => onTitle(e.target.value)}
            error={errors.title}
            maxLength={220}
            autoComplete="off"
            className="min-h-12 text-lg font-semibold"
            placeholder="Post title"
          />
        </div>

        <aside aria-label="Post settings" className="space-y-4 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <Card className="space-y-4 p-4" aria-labelledby="details-h">
            <h2 id="details-h" className="text-sm font-semibold">
              Details
            </h2>
            <Select
              label="Section"
              value={draft.section}
              onChange={(e) => update({ section: e.target.value as Section })}
              error={errors.section}
            >
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s]}
                </option>
              ))}
            </Select>
            <Input
              label="URL slug"
              value={draft.slug}
              onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/\s+/g, "-"), slugTouched: true })}
              error={errors.slug}
              hint={
                <>
                  Public URL: <span className="break-all font-mono">/{draft.section}/{draft.slug || "…"}</span>
                  {post?.status === "published" ? " — changing the slug of a published post changes its link." : null}
                </>
              }
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-sm"
            />
            <TagInput value={draft.tags} onChange={(tags) => update({ tags })} error={errors.tags} />
            <Textarea
              label="Excerpt"
              value={draft.excerpt}
              onChange={(e) => update({ excerpt: e.target.value })}
              error={errors.excerpt}
              rows={4}
              maxLength={600}
              hint={`Optional. Leave blank to generate it automatically from the post body. ${draft.excerpt.trim().length}/500`}
            />
          </Card>

          <Card className="space-y-3 p-4" aria-labelledby="cover-h">
            <h2 id="cover-h" className="text-sm font-semibold">
              Cover image
            </h2>
            {draft.coverImageUrl ? (
              <div className="aspect-[16/9] overflow-hidden rounded-lg border border-edge bg-panel-2">
                <MediaImage
                  media={{ url: draft.coverImageUrl, alt: draft.coverImageAlt || null, width: 640, height: 360 }}
                  sizes="22rem"
                />
              </div>
            ) : (
              <div className="grid aspect-[16/9] place-items-center rounded-lg border border-dashed border-edge-strong bg-panel-2 text-muted">
                <span className="flex items-center gap-2 text-sm">
                  <LuImage aria-hidden className="size-5" /> No cover image
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPickerOpen(true)}>{draft.coverImageUrl ? "Change image" : "Choose image"}</Button>
              {draft.coverImageUrl ? (
                <Button variant="ghost" onClick={() => update({ coverImageUrl: "", coverImageAlt: "" })}>
                  Remove
                </Button>
              ) : null}
            </div>
            {errors.coverImageUrl ? <p className="text-[0.8125rem] font-medium text-danger">{errors.coverImageUrl}</p> : null}
            {draft.coverImageUrl ? (
              <Input
                label="Image description (alt text)"
                value={draft.coverImageAlt}
                onChange={(e) => update({ coverImageAlt: e.target.value })}
                error={errors.coverImageAlt}
                hint="Describe the image for people using screen readers. Leave empty if purely decorative."
                maxLength={320}
              />
            ) : null}
          </Card>

          {post ? (
            <Card className="p-4 text-[0.8125rem]" aria-labelledby="info-h">
              <h2 id="info-h" className="mb-2 text-sm font-semibold">
                Info
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted">Author</dt>
                <dd>{post.author.name}</dd>
                <dt className="text-muted">Created</dt>
                <dd>{formatDateTime(post.createdAt)}</dd>
                <dt className="text-muted">Updated</dt>
                <dd>{formatDateTime(post.updatedAt)}</dd>
                {post.publishedAt ? (
                  <>
                    <dt className="text-muted">Published</dt>
                    <dd>{formatDateTime(post.publishedAt)}</dd>
                  </>
                ) : null}
                {post.scheduledFor && post.status === "scheduled" ? (
                  <>
                    <dt className="text-muted">Scheduled</dt>
                    <dd>{formatDateTime(post.scheduledFor)}</dd>
                  </>
                ) : null}
                <dt className="text-muted">Reading time</dt>
                <dd>{post.readingMinutes} min</dd>
              </dl>
              {!autosaveEligible ? (
                <p className="mt-3 text-muted">Autosave is only on for drafts. Use “Save changes” to update this post.</p>
              ) : null}
            </Card>
          ) : null}
        </aside>

        <div className="space-y-3 xl:col-start-1 xl:row-start-2">
          {large ? (
            <div role="status" className="flex items-start gap-2 rounded-ctl border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm text-warn">
              <LuTriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>
                <strong className="font-semibold">This post is large ({formatBytes(contentBytes)}).</strong> Saving may be slow or be rejected by the server.
                Resize large images before adding them, or upload them through the media library.
              </p>
            </div>
          ) : null}
          {hasEmbeddedImages ? (
            <p role="note" className="rounded-ctl bg-info-soft px-3 py-2 text-[0.8125rem] text-info">
              Pasted or dropped images are embedded in the post. They are uploaded to the media library automatically when you save.
            </p>
          ) : null}
          <Card className="overflow-hidden" aria-label="Post content">
            <div className="p-2 sm:p-3">
              <RichEditor
                key={editorSeed.key}
                initialContent={editorSeed.content}
                onChange={onEditorChange}
                onBaseline={onEditorBaseline}
                placeholder="Start writing your post…"
              />
            </div>
          </Card>
          <p className="text-[0.8125rem] text-muted">
            <Link href="/media" className="text-brand hover:underline">
              Open the media library
            </Link>{" "}
            to manage uploaded images.
          </p>
        </div>
      </div>

      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pickCover} />
      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSchedule={schedule}
        initial={post?.status === "scheduled" ? post.scheduledFor : null}
        title={post?.status === "scheduled" ? "Reschedule post" : "Schedule post"}
        description="The post is published automatically at this time."
        submitLabel={post?.status === "scheduled" ? "Reschedule" : "Schedule post"}
      />
    </>
  );
}
