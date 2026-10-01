/** Transactional email builders: plain functions returning `{ subject, html, text }` (no template engine). */
export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface LayoutInput {
  siteName: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer?: string;
}

function layout(i: LayoutInput): string {
  const paras = i.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f2937">${escapeHtml(p)}</p>`).join("");
  const button = i.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(i.button.url)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px">${escapeHtml(i.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7280">If the button does not work, copy and paste this link into your browser:<br><a href="${escapeHtml(i.button.url)}" style="color:#166534;word-break:break-all">${escapeHtml(i.button.url)}</a></p>`
    : "";
  const footer = i.footer ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#9ca3af">${escapeHtml(i.footer)}</p>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(i.heading)}</title></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px">
<tr><td><p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#166534">${escapeHtml(i.siteName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827">${escapeHtml(i.heading)}</h1>
${paras}${button}${footer}</td></tr></table></td></tr></table></body></html>`;
}

function text(i: LayoutInput): string {
  return [i.heading, "", ...i.paragraphs.flatMap((p) => [p, ""]), ...(i.button ? [`${i.button.label}: ${i.button.url}`, ""] : []), ...(i.footer ? [i.footer] : [])]
    .join("\n")
    .trim();
}

export function verifyEmail(i: { siteName: string; name: string; url: string }): Rendered {
  const l: LayoutInput = {
    siteName: i.siteName,
    heading: "Confirm your email address",
    paragraphs: [`Hi ${i.name || "there"}, thanks for signing up. Please confirm your email address to finish setting up your account.`, "This link expires in 1 hour."],
    button: { label: "Confirm email", url: i.url },
    footer: "If you did not create an account you can ignore this email.",
  };
  return { subject: `Confirm your email for ${i.siteName}`, html: layout(l), text: text(l) };
}

export function resetPasswordEmail(i: { siteName: string; name: string; url: string }): Rendered {
  const l: LayoutInput = {
    siteName: i.siteName,
    heading: "Reset your password",
    paragraphs: [`Hi ${i.name || "there"}, we received a request to reset your password.`, "This link expires in 1 hour. If you did not ask for this, you can safely ignore this email — your password will not change."],
    button: { label: "Choose a new password", url: i.url },
  };
  return { subject: `Reset your ${i.siteName} password`, html: layout(l), text: text(l) };
}

export function newsletterConfirmEmail(i: { siteName: string; url: string; unsubscribeUrl?: string }): Rendered {
  const l: LayoutInput = {
    siteName: i.siteName,
    heading: "Confirm your subscription",
    paragraphs: [`Please confirm that you would like to receive new posts from ${i.siteName} by email.`],
    button: { label: "Yes, subscribe me", url: i.url },
    footer: i.unsubscribeUrl
      ? `Not you? Ignore this message and you will not be subscribed, or unsubscribe here: ${i.unsubscribeUrl}`
      : "If you did not ask for this, ignore this message and you will not be subscribed.",
  };
  return { subject: `Confirm your subscription to ${i.siteName}`, html: layout(l), text: text(l) };
}
