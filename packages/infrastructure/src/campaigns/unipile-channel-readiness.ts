import type { CampaignChannelReadiness } from "@outbound/application/campaigns/campaign-content-generator";
import type { ProspectSource } from "@outbound/infrastructure/crm/unipile-prospect-source";
import { ProviderUnavailableError } from "@outbound/infrastructure/crm/unipile-prospect-source";

export class UnipileCampaignChannelReadiness implements CampaignChannelReadiness {
  constructor(private readonly source: (workspaceId: string) => ProspectSource) {}

  async resolveHealthyAccount(
    workspaceId: string,
    channel: Parameters<CampaignChannelReadiness["resolveHealthyAccount"]>[1],
  ) {
    const source = this.source(workspaceId);
    if (!source.resolveHealthyAccount) {
      throw new ProviderUnavailableError("Unipile account readiness is not configured");
    }
    return { provider: "unipile" as const, accountId: await source.resolveHealthyAccount(channel) };
  }
}
