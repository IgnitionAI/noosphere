import type { ChannelStrategy } from "./channel-assessment";
import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";

export const PROSPECT_DISCOVERY_JOB_TYPE = "prospect.discovery.execute";
export const CAMPAIGN_AUTOMATION_JOB_TYPE = "campaign.automation.advance";
export const CAMPAIGN_COMPOSITION_JOB_TYPE = "campaign.messages.compose";
export const OUTREACH_DISPATCH_JOB_TYPE = "outreach.dispatch";
export const INBOUND_REPLY_PROCESS_JOB_TYPE = "inbound.reply.process";
export const INBOUND_REPLY_SEND_JOB_TYPE = "inbound.reply.send";
export const CONVERSATION_COMMAND_JOB_TYPE = "conversation.command.execute";

export const CAMPAIGN_PROSPECT_SCORE_VERSION = "icp-fit-v1";

export interface CampaignProspectScore {
  readonly score: number;
  readonly eligible: boolean;
  readonly factors: readonly {
    readonly factor: string;
    readonly contribution: number;
    readonly explanation: string;
  }[];
  readonly exclusionReason: string | null;
}

export type AutonomousSourcingFilters =
  | {
      readonly channel: "linkedin";
      readonly api: "classic";
      readonly category: "people";
      readonly keywords: string;
      readonly limit: number;
      readonly exhaustive: boolean;
      readonly enrichContacts: false;
    }
  | {
      readonly channel: "email" | "whatsapp";
      readonly query: string;
      readonly sourceKinds: ChannelStrategy["sourceKinds"];
      readonly limit: number | null;
    };

export function buildAutonomousSourcingFilters(
  channel: ProspectingChannel,
  strategy: ChannelStrategy,
): AutonomousSourcingFilters {
  if (channel === "linkedin") {
    return {
      channel,
      api: "classic",
      category: "people",
      keywords: strategy.query,
      limit: 50,
      exhaustive: true,
      enrichContacts: false,
    };
  }
  return {
    channel,
    query: strategy.query,
    sourceKinds: strategy.sourceKinds,
    limit: null,
  };
}

export function scoreCampaignProspect(input: {
  readonly channel: ProspectingChannel;
  readonly icpFit: unknown;
  readonly channelIdentity: {
    readonly status?: string;
    readonly evidenceUrl?: string | null;
  } | null;
}): CampaignProspectScore {
  const fit = record(input.icpFit);
  const matches = stringArray(fit.matches);
  const gaps = stringArray(fit.gaps);
  const factors: CampaignProspectScore["factors"][number][] = [
    {
      factor: "baseline",
      contribution: 25,
      explanation: "Candidat issu d’un sourcing dédié à cet ICP.",
    },
  ];
  if (matches.length) {
    factors.push({
      factor: "icp_matches",
      contribution: Math.min(45, matches.length * 15),
      explanation: `${matches.length} correspondance(s) ICP observée(s).`,
    });
  }
  if (gaps.length) {
    factors.push({
      factor: "icp_gaps",
      contribution: -Math.min(24, gaps.length * 8),
      explanation: `${gaps.length} information(s) manquante(s) ou divergente(s).`,
    });
  }
  const status = input.channelIdentity?.status ?? "unavailable";
  const identityEligible = input.channel === "whatsapp"
    ? status === "verified"
    : status === "verified" || status === "found";
  if (identityEligible) {
    factors.push({
      factor: "channel_identity",
      contribution: status === "verified" ? 25 : 18,
      explanation: status === "verified"
        ? `Identité ${input.channel} vérifiée.`
        : `Identité ${input.channel} professionnelle trouvée.`,
    });
  }
  if (input.channelIdentity?.evidenceUrl) {
    factors.push({
      factor: "public_evidence",
      contribution: 5,
      explanation: "Une preuve publique résoluble est associée à l’identité.",
    });
  }
  const score = Math.max(
    0,
    Math.min(100, factors.reduce((total, factor) => total + factor.contribution, 0)),
  );
  const exclusionReason = !identityEligible
    ? `NO_ELIGIBLE_${input.channel.toUpperCase()}_IDENTITY`
    : score < 45
      ? "ICP_SCORE_BELOW_THRESHOLD"
      : null;
  return { score, eligible: exclusionReason === null, factors, exclusionReason };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
