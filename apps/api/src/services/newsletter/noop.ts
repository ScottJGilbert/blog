import type { Logger } from "../../logger";
import type { CampaignStats, NewsletterProvider, TestCampaignInput } from "./provider";

/** Used when LISTMONK_URL is not configured: logs and does nothing. Callers should surface "not configured" in the admin UI. */
export class NoopProvider implements NewsletterProvider {
  readonly kind = "noop";

  constructor(private readonly logger?: Logger) {}

  async upsertSubscriber(_email: string, _name?: string): Promise<{ externalId: string }> {
    this.logger?.debug("[newsletter:noop] upsertSubscriber skipped (no newsletter provider configured)");
    return { externalId: "noop" };
  }
  async removeSubscriber(_externalIdOrEmail: string): Promise<void> {
    this.logger?.debug("[newsletter:noop] removeSubscriber skipped");
  }
  async sendCampaign(input: { subject: string; html: string; preheader?: string; name: string }): Promise<{ campaignId: string }> {
    this.logger?.warn(`[newsletter:noop] campaign "${input.name}" NOT sent: no newsletter provider configured (set LISTMONK_URL)`);
    return { campaignId: "noop" };
  }
  async testCampaign(_input: TestCampaignInput): Promise<void> {
    this.logger?.warn("[newsletter:noop] test campaign NOT sent: no newsletter provider configured");
  }
  async campaignStats(_campaignId: string): Promise<CampaignStats> {
    return { sent: 0, toSend: 0, views: 0, clicks: 0, bounces: 0, status: "noop" };
  }
}
