/**
 * Newsletter delivery backend (listmonk in production, no-op otherwise).
 * `ListmonkProvider` is implemented by WP B2 in `./listmonk.ts`; keep this contract stable.
 */
export interface CampaignStats {
  sent: number;
  toSend: number;
  views: number;
  clicks: number;
  bounces: number;
  /** provider-specific status string, e.g. listmonk "running" / "finished" */
  status?: string;
}

export type TestCampaignInput = { subject: string; to: string } & ({ campaignId: string; html?: undefined } | { html: string; campaignId?: undefined });

export interface NewsletterProvider {
  /** Optional: "listmonk" | "noop". Lets callers surface a "not configured" warning. */
  readonly kind?: string;
  /** Create/update a subscriber on the mailing list. `externalId` is the provider's id (listmonk: numeric id as string). */
  upsertSubscriber(email: string, name?: string): Promise<{ externalId: string }>;
  /** Remove / blocklist a subscriber by provider id or email. */
  removeSubscriber(externalIdOrEmail: string): Promise<void>;
  /** Create AND start a campaign. */
  sendCampaign(input: { subject: string; html: string; preheader?: string; name: string }): Promise<{ campaignId: string }>;
  /** Send a test copy of an existing campaign (`campaignId`) or of raw `html` to one address. */
  testCampaign(input: TestCampaignInput): Promise<void>;
  campaignStats(campaignId: string): Promise<CampaignStats>;
  /** Optional (additive): start an already created campaign again, e.g. after a failed start. */
  startCampaign?(campaignId: string): Promise<void>;
  /** Optional (additive): permanently delete a subscriber (right to erasure) instead of blocklisting. */
  deleteSubscriber?(externalIdOrEmail: string): Promise<void>;
}
