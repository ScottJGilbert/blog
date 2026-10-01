import type { MailMessage, Mailer } from "./types";

/** Test driver: records every message in `outbox`. */
export class MemoryMailer implements Mailer {
  readonly driver = "memory";
  readonly outbox: MailMessage[] = [];
  /** Set to make `send` reject (to test failure paths). */
  failWith: Error | null = null;

  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.outbox.push(message);
  }

  clear(): void {
    this.outbox.length = 0;
  }

  /** Messages sent to `to` (case-insensitive), oldest first. */
  to(to: string): MailMessage[] {
    return this.outbox.filter((m) => m.to.toLowerCase() === to.toLowerCase());
  }

  /** The most recent message (optionally to a given recipient). */
  last(to?: string): MailMessage | undefined {
    const list = to ? this.to(to) : this.outbox;
    return list[list.length - 1];
  }
}

/** All http(s) URLs in a message's text body. */
export function extractLinks(message: MailMessage): string[] {
  return [...message.text.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) => m[0].replace(/[.,)]+$/, ""));
}

/** First URL whose string matches `pattern` (e.g. `/verify-email/`). */
export function findLink(message: MailMessage, pattern: RegExp): string | undefined {
  return extractLinks(message).find((l) => pattern.test(l));
}
