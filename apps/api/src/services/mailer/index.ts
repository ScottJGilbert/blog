import type { Config } from "../../config";
import type { Logger } from "../../logger";
import { ConsoleMailer } from "./console";
import { ResendMailer } from "./resend";
import { SmtpMailer } from "./smtp";
import type { Mailer } from "./types";

export * from "./types";
export * from "./templates";
export { ConsoleMailer } from "./console";
export { MemoryMailer, extractLinks, findLink } from "./memory";
export { SmtpMailer } from "./smtp";
export { ResendMailer } from "./resend";

/** Choose the driver from config; a misconfigured smtp/resend degrades to console with a warning (never crashes). */
export function createMailer(config: Config, logger: Logger, fetchImpl: typeof fetch = fetch): Mailer {
  const { driver, smtpUrl, resendApiKey, from } = config.mailer;
  if (driver === "smtp") {
    if (smtpUrl) return new SmtpMailer(smtpUrl, from);
    logger.warn("MAILER_DRIVER=smtp but SMTP_URL is not set; falling back to the console mailer");
  } else if (driver === "resend") {
    if (resendApiKey) return new ResendMailer(resendApiKey, from, fetchImpl);
    logger.warn("MAILER_DRIVER=resend but RESEND_API_KEY is not set; falling back to the console mailer");
  }
  return new ConsoleMailer(logger, { logBodies: !config.isProd });
}
