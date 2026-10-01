export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Overrides MAIL_FROM. */
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  readonly driver: string;
  /** Resolves when the message was accepted by the transport; rejects on failure. */
  send(message: MailMessage): Promise<void>;
}
