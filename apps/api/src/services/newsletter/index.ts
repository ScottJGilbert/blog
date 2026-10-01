import type { Config } from "../../config";
import type { Logger } from "../../logger";
import { ListmonkProvider } from "./listmonk";
import { NoopProvider } from "./noop";
import type { NewsletterProvider } from "./provider";

export * from "./provider";
export { NoopProvider } from "./noop";
export { ListmonkProvider, ListmonkError } from "./listmonk";
export type { ListmonkConfig, ListmonkOptions } from "./listmonk";

/**
 * Pick the newsletter backend: `ListmonkProvider` when `LISTMONK_URL` (+ user/token) is configured, else the no-op provider.
 * Optional extras read straight from the environment (not part of `Config`):
 *   LISTMONK_AUTH_SCHEME=token|basic   (default token → `Authorization: token user:token`)
 *   LISTMONK_TEMPLATE_ID=<n>           (campaign template; default: auto-managed pass-through template)
 *   LISTMONK_FROM_EMAIL="Name <a@b.c>" (campaign `from_email`)
 */
export function createNewsletterProvider(config: Config, logger: Logger, fetchImpl: typeof fetch = fetch): NewsletterProvider {
  if (!config.listmonk.enabled) return new NoopProvider(logger);
  const templateId = Number(process.env.LISTMONK_TEMPLATE_ID);
  return new ListmonkProvider(config.listmonk, logger, fetchImpl, {
    authScheme: process.env.LISTMONK_AUTH_SCHEME?.toLowerCase() === "basic" ? "basic" : "token",
    ...(Number.isInteger(templateId) && templateId > 0 ? { templateId } : {}),
    ...(process.env.LISTMONK_FROM_EMAIL ? { fromEmail: process.env.LISTMONK_FROM_EMAIL } : {}),
  });
}
