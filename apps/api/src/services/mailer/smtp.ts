import type { Transporter } from "nodemailer";
import type { MailMessage, Mailer } from "./types";

export class SmtpMailer implements Mailer {
  readonly driver = "smtp";
  private transport?: Promise<Transporter>;

  constructor(
    private readonly smtpUrl: string,
    private readonly defaultFrom: string,
  ) {}

  /** nodemailer is loaded on first use (cold-start time), then reused by every later send of the instance. */
  private getTransport(): Promise<Transporter> {
    this.transport ??= import("nodemailer").then((m) =>
      m.default.createTransport(this.smtpUrl, { connectionTimeout: 10_000, socketTimeout: 15_000, greetingTimeout: 10_000 }),
    );
    return this.transport;
  }

  async send(m: MailMessage): Promise<void> {
    await (await this.getTransport()).sendMail({
      from: m.from ?? this.defaultFrom,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
      headers: m.headers,
    });
  }
}
