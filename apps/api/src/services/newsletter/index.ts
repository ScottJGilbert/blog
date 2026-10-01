import type { Config } from "../../config";
import type { Logger } from "../../logger";
import { NoopProvider } from "./noop";
import type { NewsletterProvider } from "./provider";

export * from "./provider";
export { NoopProvider } from "./noop";

/**
 * Pick the newsletter backend.
 * WP B2: return `new ListmonkProvider(config.listmonk, logger, fetchImpl)` when `config.listmonk.enabled`.
 */
export function createNewsletterProvider(config: Config, logger: Logger, _fetchImpl: typeof fetch = fetch): NewsletterProvider {
  if (config.listmonk.enabled) {
    logger.warn("LISTMONK_URL is set but ListmonkProvider is not implemented yet; using the no-op newsletter provider");
  }
  return new NoopProvider(logger);
}
