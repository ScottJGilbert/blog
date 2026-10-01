import { emptyContent, escapeHtml, renderContent, validateContent, wrapEmailHtml } from "@blog/content";
import type { LexicalContent } from "@blog/shared";
import type { Config } from "../../config";
import { HttpError } from "../../errors";
import { defuseTemplateTags } from "../../lib/text";

/** listmonk template tags understood in campaign bodies (https://listmonk.app/docs/templating/). */
export const UNSUBSCRIBE_TAG = "{{ UnsubscribeURL }}";
export const MESSAGE_TAG = "{{ MessageURL }}";

const LINK = 'style="color:#6b7280;text-decoration:underline"';

/**
 * Newsletter HTML: the content rendered for the `email` target with absolute URLs (baseUrl = SITE_URL), wrapped in the
 * 600px email document with a footer holding listmonk's unsubscribe / view-in-browser tags.
 *
 * Go-template delimiters inside user content (`{{`) are HTML-escaped so a stray `{{ x }}` in a post can never break
 * (or inject into) listmonk's template compilation.
 */
export function renderNewsletterHtml(
  config: Pick<Config, "siteUrl" | "siteName">,
  input: { subject: string; preheader?: string | null; content: unknown },
): string {
  const { html: fragment } = renderContent(input.content, { target: "email", baseUrl: config.siteUrl });
  const safeFragment = fragment.replaceAll("{{", "&#123;&#123;");
  const footerHtml =
    `You are receiving this email because you subscribed to ${escapeHtml(defuseTemplateTags(config.siteName))}.<br>` +
    `<a href="${UNSUBSCRIBE_TAG}" ${LINK}>Unsubscribe</a> &middot; <a href="${MESSAGE_TAG}" ${LINK}>View in browser</a>`;
  return wrapEmailHtml(safeFragment, {
    // subject / preheader are admin text, but listmonk compiles the whole body as a Go template: defuse `{{` there too
    title: defuseTemplateTags(input.subject),
    preheader: defuseTemplateTags(input.preheader?.trim() ?? "") || undefined,
    footerHtml,
  });
}

/** HTML for the admin preview iframe: the listmonk tags are replaced by inert anchors. */
export function previewHtml(html: string): string {
  return html.replaceAll(UNSUBSCRIBE_TAG, "#unsubscribe").replaceAll(MESSAGE_TAG, "#view-in-browser");
}

export const blankContent = (): LexicalContent => emptyContent() as unknown as LexicalContent;

/** Throws 422 when the content is structurally invalid (warnings are fine). */
export function assertValidContent(content: unknown): void {
  const v = validateContent(content);
  if (!v.ok) {
    throw new HttpError(422, "validation_error", "The newsletter content is not valid", {
      details: v.errors.map((e) => ({ path: ["content", e.path], code: e.code, message: e.message })),
    });
  }
}

const text = (value: string) => ({ type: "text", version: 1, text: value, format: 0, style: "", mode: "normal", detail: 0 });
const element = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  type,
  version: 1,
  children,
  direction: "ltr",
  format: "",
  indent: 0,
  ...extra,
});

/**
 * Newsletter body for a post: cover image, the title as heading, the post's own blocks and a "read on the site" link.
 * The result is ordinary Lexical JSON, so the admin can keep editing it in the newsletter composer.
 */
export function contentFromPost(
  post: { title: string; slug: string; section: string; content: unknown; coverImageUrl: string | null; coverImageAlt: string | null },
  siteUrl: string,
): LexicalContent {
  const body = (post.content as { root?: { children?: unknown[] } })?.root?.children ?? [];
  const url = `${siteUrl.replace(/\/+$/, "")}/${post.section}/${post.slug}`;
  const children: unknown[] = [];
  if (post.coverImageUrl) {
    children.push({
      type: "image",
      version: 1,
      src: post.coverImageUrl,
      altText: post.coverImageAlt ?? "",
      width: 0,
      height: 0,
      maxWidth: 600,
      showCaption: false,
    });
  }
  children.push(element("heading", [text(post.title)], { tag: "h1" }));
  children.push(...body);
  children.push(
    element("paragraph", [
      element("link", [text("Read this post on the website")], { url, rel: "noopener noreferrer", target: null, title: null }),
    ], { textFormat: 0, textStyle: "" }),
  );
  return { root: element("root", children) } as unknown as LexicalContent;
}
