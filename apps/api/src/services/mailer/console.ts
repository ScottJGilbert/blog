import type { Logger } from "../../logger";
import type { MailMessage, Mailer } from "./types";

/**
 * Dev/test driver: nothing leaves the process. In development the full text body (including verification links)
 * is logged so you can click through flows. In production only metadata is logged (bodies hold secret tokens).
 */
export class ConsoleMailer implements Mailer {
  readonly driver = "console";
  constructor(
    private readonly logger: Logger,
    private readonly opts: { logBodies: boolean } = { logBodies: true },
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (this.opts.logBodies) {
      // dev only: the body (verification / reset links) is the point of this driver; the recipient is masked (no full e-mails in logs)
      this.logger.info({ to: message.to.replace(/^(.).*(@.*)$/, "$1***$2"), subject: message.subject }, `[mail:console] ${message.subject}\n${message.text}`);
    } else {
      this.logger.warn({ subject: message.subject }, "[mail:console] MAILER_DRIVER=console in production: email NOT delivered");
    }
  }
}
