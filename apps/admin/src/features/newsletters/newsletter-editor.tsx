"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { LuCalendarClock, LuLaptop, LuRefreshCw, LuSend, LuSmartphone, LuTablet, LuTriangleAlert, LuUndo2 } from "react-icons/lu";
import { isApiError } from "@blog/shared/client";
import type { LexicalContent, Newsletter } from "@blog/shared";
import { Card, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/empty-state";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { RichEditor } from "@/features/editor/rich-editor";
import { ScheduleDialog } from "@/features/posts/schedule-dialog";
import { api } from "@/lib/api";
import { errorMessage, fieldErrorsFromApi, type FieldErrors } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/unsaved-guard";
import { emptyContentDoc } from "./empty-doc";

type Tab = "compose" | "preview" | "send";
type Mode = "custom" | "post";
interface Draft {
  subject: string;
  preheader: string;
  mode: Mode;
  postId: string;
  contentStr: string;
}

const snap = (d: Draft) => JSON.stringify(d);

export function NewsletterEditor({ id }: { id: string }) {
  const { data, error, mutate } = useSWR(["newsletter", id], () => api.admin.newsletters.get(id), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
  if (data) return <Form key={data.id} initial={data} onUpdated={(n) => mutate(n, { revalidate: false })} />;
  if (error) {
    const nf = isApiError(error) && error.status === 404;
    return (
      <>
        <PageHeader title={nf ? "Newsletter not found" : "Could not load newsletter"} crumbs={[{ label: "Newsletters", href: "/newsletters" }, { label: "Edit" }]} />
        <Card>
          <ErrorState title={nf ? "This newsletter does not exist" : "Could not load this newsletter"} message={nf ? "It may have been deleted." : errorMessage(error)} onRetry={nf ? undefined : () => mutate()} />
          <div className="pb-6 text-center">
            <LinkButton href="/newsletters">Back to newsletters</LinkButton>
          </div>
        </Card>
      </>
    );
  }
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading newsletter…</span>
      <PageHeader title="Edit newsletter" crumbs={[{ label: "Newsletters", href: "/newsletters" }, { label: "Edit" }]} />
      <Skeleton className="mb-3 h-12 w-full" />
      <Skeleton className="h-[34rem] w-full" />
    </div>
  );
}

function toDraft(n: Newsletter): Draft {
  return {
    subject: n.subject,
    preheader: n.preheader ?? "",
    mode: n.postId ? "post" : "custom",
    postId: n.postId ?? "",
    contentStr: JSON.stringify(n.content ?? emptyContentDoc()),
  };
}

const DEVICES = [
  { id: "mobile", label: "Mobile", width: 375, icon: LuSmartphone },
  { id: "tablet", label: "Tablet", width: 768, icon: LuTablet },
  { id: "desktop", label: "Desktop", width: 0, icon: LuLaptop },
] as const;

function Form({ initial, onUpdated }: { initial: Newsletter; onUpdated: (n: Newsletter) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [nl, setNl] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const savedRef = useRef<Draft>(toDraft(initial));
  const [savedSnap, setSavedSnap] = useState(() => snap(toDraft(initial)));
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("compose");
  const [seed] = useState<LexicalContent>(() => initial.content ?? emptyContentDoc());

  const readOnly = nl.status === "sent" || nl.status === "sending";
  const dirty = snap(draft) !== savedSnap;
  useUnsavedGuard(dirty, { what: "this newsletter" });

  const { data: posts } = useSWR(draft.mode === "post" ? ["posts", { picker: "published" }] : null, () => api.admin.posts.list({ status: "published", pageSize: 50 }));
  const { data: system } = useSWR(["system"], () => api.admin.system());

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const onBaseline = useCallback((json: string) => {
    setDraft((d) => ({ ...d, contentStr: json }));
    savedRef.current = { ...savedRef.current, contentStr: json };
    setSavedSnap(snap(savedRef.current));
  }, []);
  const editorFlush = useRef<(() => void) | null>(null);
  const onContent = useCallback((json: string) => {
    draftRef.current = { ...draftRef.current, contentStr: json };
    setDraft((d) => ({ ...d, contentStr: json }));
  }, []);

  function validate(d: Draft): FieldErrors {
    const e: FieldErrors = {};
    if (!d.subject.trim()) e.subject = "Enter a subject line.";
    else if (d.subject.trim().length > 200) e.subject = "The subject can be at most 200 characters.";
    if (d.preheader.trim().length > 300) e.preheader = "The preheader can be at most 300 characters.";
    if (d.mode === "post" && !d.postId) e.postId = "Choose a post.";
    return e;
  }

  const save = useCallback(async (): Promise<Newsletter | null> => {
    editorFlush.current?.();
    const d = draftRef.current;
    if (snap(d) === snap(savedRef.current)) return nl;
    const errs = validate(d);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Fix the highlighted fields before saving.");
      return null;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await api.admin.newsletters.update(nl.id, {
        subject: d.subject.trim(),
        preheader: d.preheader.trim() || null,
        postId: d.mode === "post" ? d.postId : null,
        content: d.mode === "custom" ? (JSON.parse(d.contentStr) as LexicalContent) : null,
      });
      savedRef.current = d;
      setSavedSnap(snap(d));
      setNl(res);
      onUpdated(res);
      void globalMutate((k) => Array.isArray(k) && k[0] === "newsletters");
      return res;
    } catch (err) {
      setErrors(fieldErrorsFromApi(err));
      setFormError(errorMessage(err));
      toast.error(errorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, [nl, toast, onUpdated]);

  // ----- preview ---------------------------------------------------------------------------------------------------
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const loadPreview = useCallback(async () => {
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const saved = await save();
      if (!saved) throw new Error("Fix the highlighted fields to preview.");
      const r = await api.admin.newsletters.preview(saved.id);
      setHtml(r.html);
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setPreviewBusy(false);
    }
  }, [save]);

  function changeTab(t: Tab) {
    setTab(t);
    if (t === "preview" && (html === null || dirty)) void loadPreview();
  }

  // ----- send / test / schedule -------------------------------------------------------------------------------------
  const [testEmail, setTestEmail] = useState("");
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warn" | "ok" | "danger"; text: string } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const { data: confirmed } = useSWR(["subscribers", "confirmed-count"], () => api.admin.subscribers.list({ status: "confirmed", pageSize: 1 }).then((r) => r.meta.total));

  async function sendTest() {
    const email = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setTestError("Enter a valid email address.");
    setTestError(null);
    setTesting(true);
    try {
      const saved = await save();
      if (!saved) return;
      const r = await api.admin.newsletters.test(saved.id, { email });
      if (r.warning) setNotice({ tone: "warn", text: r.warning });
      else setNotice({ tone: "ok", text: `Test email sent to ${email}.` });
      toast[r.warning ? "info" : "success"](r.warning ?? `Test email sent to ${email}`);
    } catch (err) {
      setTestError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function sendNow() {
    const saved = await save();
    if (!saved) return;
    const ok = await confirm({
      title: "Send this newsletter now?",
      description: (
        <>
          “{saved.subject}” will be sent to {confirmed != null ? <strong>{confirmed.toLocaleString("en")} confirmed subscribers</strong> : "all confirmed subscribers"}.
          {system && !system.newsletter.configured ? " The newsletter provider is not configured, so nothing will actually be delivered." : " This cannot be undone."}
        </>
      ),
      confirmLabel: "Send now",
      tone: "danger",
    });
    if (!ok) return;
    setSending(true);
    try {
      const r = await api.admin.newsletters.send(saved.id);
      setNl(r.newsletter);
      onUpdated(r.newsletter);
      void globalMutate((k) => Array.isArray(k) && k[0] === "newsletters");
      if (r.warning) {
        setNotice({ tone: r.newsletter.status === "failed" ? "danger" : "warn", text: r.warning });
        toast.info(r.warning);
      } else {
        setNotice({ tone: "ok", text: "Newsletter sent." });
        toast.success("Newsletter sent");
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function schedule(iso: string) {
    const saved = await save();
    if (!saved) throw new Error("Fix the highlighted fields before scheduling.");
    const res = await api.admin.newsletters.schedule(saved.id, { scheduledFor: iso });
    setNl(res);
    onUpdated(res);
    toast.success(`Scheduled for ${formatDateTime(iso)}`);
    void globalMutate((k) => Array.isArray(k) && k[0] === "newsletters");
  }

  async function unschedule() {
    try {
      const res = await api.admin.newsletters.unschedule(nl.id);
      setNl(res);
      onUpdated(res);
      toast.success("Schedule cancelled — back to draft");
      void globalMutate((k) => Array.isArray(k) && k[0] === "newsletters");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // ----- stats -------------------------------------------------------------------------------------------------------
  const showStats = nl.status === "sent" || nl.status === "sending" || nl.status === "failed";
  const { data: stats, isValidating: statsBusy, mutate: refreshStats } = useSWR(showStats ? ["newsletters", "stats", nl.id] : null, () => api.admin.newsletters.stats(nl.id));

  const deviceWidth = DEVICES.find((d) => d.id === device)!.width;

  return (
    <>
      <PageHeader
        title={nl.subject || "Newsletter"}
        titleSuffix={<StatusBadge status={nl.status} />}
        crumbs={[{ label: "Newsletters", href: "/newsletters" }, { label: "Edit" }]}
        actions={
          !readOnly ? (
            <Button variant="primary" onClick={() => void save().then((r) => r && toast.success("Newsletter saved"))} loading={saving} disabled={!dirty}>
              {dirty ? "Save changes" : "Saved"}
            </Button>
          ) : null
        }
      />
      <p role="status" aria-live="polite" className={cn("mb-3 min-h-5 text-sm font-medium", dirty ? "text-warn" : "text-muted")}>
        {dirty ? "Unsaved changes" : readOnly ? "This newsletter has been sent and can no longer be edited." : "All changes saved"}
      </p>
      <FormError>{formError}</FormError>

      <Card className="mt-3">
        <Tabs
          label="Newsletter sections"
          value={tab}
          onChange={changeTab}
          tabs={[
            { id: "compose", label: "Compose" },
            { id: "preview", label: "Preview" },
            { id: "send", label: "Send & stats" },
          ]}
        >
          <div hidden={tab !== "compose"} className="space-y-4 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Subject" required value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} error={errors.subject} disabled={readOnly} maxLength={220} />
              <Input label="Preheader" value={draft.preheader} onChange={(e) => patch({ preheader: e.target.value })} error={errors.preheader} disabled={readOnly} hint="Preview text shown after the subject in inboxes." maxLength={320} />
            </div>
            <fieldset className="space-y-2" disabled={readOnly}>
              <legend className="mb-1 text-sm font-medium">Content</legend>
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ["custom", "Write custom content"],
                    ["post", "Use a post"],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="nl-mode" checked={draft.mode === v} onChange={() => patch({ mode: v })} className="size-4 border-edge-strong text-brand" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {draft.mode === "post" ? (
              <div className="max-w-xl">
                <Select label="Post" required value={draft.postId} onChange={(e) => patch({ postId: e.target.value })} error={errors.postId} disabled={readOnly} hint="The newsletter body is rendered from this post (email-safe layout).">
                  <option value="">{posts ? "Select a published post…" : "Loading posts…"}</option>
                  {posts?.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                  {draft.postId && posts && !posts.data.some((p) => p.id === draft.postId) ? <option value={draft.postId}>(current post)</option> : null}
                </Select>
              </div>
            ) : (
              <div className={cn("overflow-hidden rounded-lg border border-edge", readOnly && "pointer-events-none opacity-70")}>
                <div className="p-2 sm:p-3">
                  <RichEditor initialContent={seed} onChange={onContent} onBaseline={onBaseline} flushRef={editorFlush} placeholder="Write your newsletter…" />
                </div>
              </div>
            )}
          </div>

          <div hidden={tab !== "preview"} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Preview width" className="inline-flex overflow-hidden rounded-ctl border border-edge-strong">
                {DEVICES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={device === d.id}
                    onClick={() => setDevice(d.id)}
                    className={cn("inline-flex min-h-10 items-center gap-1.5 px-3 text-sm font-medium", device === d.id ? "bg-brand text-brand-ink" : "bg-panel hover:bg-panel-2")}
                  >
                    <d.icon aria-hidden className="size-4" />
                    {d.label}
                    {d.width ? <span className="sr-only"> ({d.width}px)</span> : null}
                  </button>
                ))}
              </div>
              <Button onClick={() => void loadPreview()} loading={previewBusy} icon={<LuRefreshCw aria-hidden className="size-4" />}>
                Refresh preview
              </Button>
            </div>
            {previewError ? <FormError>{previewError}</FormError> : null}
            <div className="overflow-x-auto rounded-lg border border-edge bg-panel-2 p-3">
              {html === null ? (
                <div role="status" className="grid h-[32rem] place-items-center text-sm text-muted">
                  {previewBusy ? "Rendering preview…" : "Open this tab to render a preview."}
                </div>
              ) : (
                <iframe
                  title="Newsletter preview"
                  // Empty sandbox: no scripts, no forms, no same-origin access. Email HTML is untrusted-ish content.
                  sandbox=""
                  srcDoc={html}
                  style={{ width: deviceWidth ? `${deviceWidth}px` : "100%", maxWidth: "100%" }}
                  className="mx-auto block h-[36rem] rounded-md border-0 bg-white"
                />
              )}
            </div>
          </div>

          <div hidden={tab !== "send"} className="space-y-5 p-4">
            {notice ? (
              <div
                role="status"
                className={cn(
                  "flex items-start gap-2 rounded-ctl border px-3 py-2.5 text-sm font-medium",
                  notice.tone === "ok" ? "border-ok/40 bg-ok-soft text-ok" : notice.tone === "danger" ? "border-danger/40 bg-danger-soft text-danger" : "border-warn/40 bg-warn-soft text-warn",
                )}
              >
                <LuTriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{notice.text}</span>
              </div>
            ) : null}
            {system && !system.newsletter.configured ? (
              <p className="rounded-ctl bg-warn-soft px-3 py-2 text-sm text-warn">
                The newsletter provider is not configured. You can build and preview newsletters, but sending will not deliver any emails until LISTMONK_URL is set.
              </p>
            ) : null}

            <section aria-labelledby="test-h" className="max-w-xl space-y-2">
              <h2 id="test-h" className="text-sm font-semibold">
                Send a test
              </h2>
              <Field label="Test email address" error={testError}>
                {(c) => (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input {...c} type="email" className="ctl" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
                    <Button onClick={sendTest} loading={testing} icon={<LuSend aria-hidden className="size-4" />} className="shrink-0">
                      Send test
                    </Button>
                  </div>
                )}
              </Field>
            </section>

            <section aria-labelledby="send-h" className="space-y-2 border-t border-edge pt-4">
              <h2 id="send-h" className="text-sm font-semibold">
                Send to subscribers
              </h2>
              {nl.status === "scheduled" && nl.scheduledFor ? (
                <p className="text-sm">
                  Scheduled for <strong>{formatDateTime(nl.scheduledFor)}</strong>.
                </p>
              ) : null}
              {nl.status === "sent" ? (
                <p className="text-sm">Sent {formatDateTime(nl.sentAt)}.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={sendNow} loading={sending} disabled={readOnly} icon={<LuSend aria-hidden className="size-4" />}>
                    Send now…
                  </Button>
                  <Button onClick={() => setScheduleOpen(true)} disabled={readOnly} icon={<LuCalendarClock aria-hidden className="size-4" />}>
                    {nl.status === "scheduled" ? "Reschedule…" : "Schedule…"}
                  </Button>
                  {nl.status === "scheduled" ? (
                    <Button onClick={unschedule} icon={<LuUndo2 aria-hidden className="size-4" />}>
                      Cancel schedule
                    </Button>
                  ) : null}
                </div>
              )}
              <p className="text-[0.8125rem] text-muted">Recipients: {confirmed != null ? `${confirmed.toLocaleString("en")} confirmed subscribers` : "confirmed subscribers"}.</p>
            </section>

            {showStats ? (
              <section aria-labelledby="stats-h" className="space-y-2 border-t border-edge pt-4">
                <div className="flex items-center justify-between">
                  <h2 id="stats-h" className="text-sm font-semibold">
                    Delivery stats
                  </h2>
                  <Button size="sm" onClick={() => void refreshStats()} loading={statsBusy} icon={<LuRefreshCw aria-hidden className="size-4" />}>
                    Refresh
                  </Button>
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["Sent", stats?.sent ?? nl.stats?.sent],
                      ["Opens", stats?.views ?? nl.stats?.views],
                      ["Clicks", stats?.clicks ?? nl.stats?.clicks],
                      ["Bounces", stats?.bounces ?? nl.stats?.bounces],
                    ] as const
                  ).map(([label, v]) => (
                    <div key={label} className="rounded-lg border border-edge p-3">
                      <dt className="text-[0.8125rem] text-muted">{label}</dt>
                      <dd className="text-2xl font-semibold tabular-nums">{v ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </div>
        </Tabs>
      </Card>

      <ScheduleDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} onSchedule={schedule} initial={nl.scheduledFor} title="Schedule newsletter" description="The newsletter is sent automatically at this time." submitLabel="Schedule" />
    </>
  );
}
