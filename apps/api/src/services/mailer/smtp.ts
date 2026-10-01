import nodemailer, { type Transporter } from "nodemailer";
import type { MailMessage, Mailer } from "./types";

export class SmtpMailer implements Mailer {
  readonly driver = "smtp";
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly defaultFrom: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl, { connectionTimeout: 10_000, socketTimeout: 15_000, greetingTimeout: 10_000 });
  }

  async send(m: MailMessage): Promise<void> {
    await this.transport.sendMail({
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
