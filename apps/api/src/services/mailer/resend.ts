import type { MailMessage, Mailer } from "./types";

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email), via plain fetch. */
export class ResendMailer implements Mailer {
  readonly driver = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly defaultFrom: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = "https://api.resend.com/emails",
  ) {}

  async send(m: MailMessage): Promise<void> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: m.from ?? this.defaultFrom,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        reply_to: m.replyTo,
        headers: m.headers,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`Resend responded ${res.status}${detail ? `: ${detail}` : ""}`);
    }
  }
}
