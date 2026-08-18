import type { CampaignChannelReadiness } from "@outbound/application/campaigns/campaign-content-generator";
import type { PostgresUnipileChannelConnections } from "@outbound/infrastructure/channels/postgres-unipile-channel-connections";

export class UnipileCampaignChannelReadiness implements CampaignChannelReadiness {
  constructor(private readonly connections: PostgresUnipileChannelConnections) {}

  async resolveHealthyAccount(
    workspaceId: string,
    channel: Parameters<CampaignChannelReadiness["resolveHealthyAccount"]>[1],
  ) {
    return {
      provider: "unipile" as const,
      accountId: await this.connections.resolveHealthyAccount(workspaceId, channel),
    };
  }
}
