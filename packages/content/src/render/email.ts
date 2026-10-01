/**
 * Helpers for newsletter HTML: wrap a rendered fragment in a table-based, 600px-wide email document.
 */
import { escapeHtml } from "../escape";
import type { ContentInput, RenderOptions } from "../types";
import { EMAIL } from "./email-styles";
import { renderContent } from "./html";

export interface EmailDocumentOptions {
  /** `<title>` (usually the subject). */
  title?: string;
  /** Hidden inbox-preview text. */
  preheader?: string;
  /** Content column width in px (default 600). */
  maxWidth?: number;
  /** `lang` attribute (default `en`). */
  lang?: string;
  /**
   * Raw HTML appended below the content (unsubscribe links, address…). NOT escaped: pass trusted markup only.
   */
  footerHtml?: string;
  /** Background behind the column (default `#f4f5f7`). */
  backgroundColor?: string;
}

const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

/** Wrap an email-target fragment into a complete HTML document. */
export function wrapEmailHtml(fragment: string, opts: EmailDocumentOptions = {}): string {
  const width = Math.min(Math.max(Math.floor(opts.maxWidth ?? 600), 280), 800);
  const bg = opts.backgroundColor && SAFE_COLOR.test(opts.backgroundColor) ? opts.backgroundColor : "#f4f5f7";
  const lang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(opts.lang ?? "en") ? opts.lang ?? "en" : "en";
  const preheader = opts.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(opts.preheader)}</div>`
    : "";
  return (
    `<!DOCTYPE html><html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<meta http-equiv="X-UA-Compatible" content="IE=edge"><title>${escapeHtml(opts.title ?? "")}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${bg};-webkit-text-size-adjust:100%">${preheader}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${width}px;background-color:#ffffff;border-radius:8px">` +
    `<tr><td style="padding:24px 28px;font-family:${EMAIL.font};font-size:16px;line-height:1.6;color:#1f2a37">${fragment}</td></tr>` +
    (opts.footerHtml
      ? `<tr><td style="padding:16px 28px 24px;font-family:${EMAIL.font};font-size:12px;line-height:1.5;color:#6b7280;border-top:1px solid #e5e7eb">${opts.footerHtml}</td></tr>`
      : "") +
    `</table></td></tr></table></body></html>`
  );
}

/** Render content for email and wrap it in a full document in one go. */
export function renderEmailDocument(
  content: ContentInput,
  options: Omit<RenderOptions, "target"> & EmailDocumentOptions = {},
): { html: string; fragment: string; warnings: ReturnType<typeof renderContent>["warnings"] } {
  const { fragment, warnings } = (() => {
    const r = renderContent(content, { ...options, target: "email" });
    return { fragment: r.html, warnings: r.warnings };
  })();
  return { html: wrapEmailHtml(fragment, options), fragment, warnings };
}
