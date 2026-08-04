import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { SequenceStepInput } from "@outbound/domain/campaigns/sequence-validation";

export interface PersonalizedCampaignStep {
  readonly position: number;
  readonly subject: string | null;
  readonly body: string;
}

export interface PersonalizedCampaignContent {
  readonly steps: readonly PersonalizedCampaignStep[];
  readonly assessment?: {
    readonly summary: string;
    readonly strengths: readonly string[];
    readonly risks: readonly string[];
    readonly recommendedAngle: string;
  };
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
  };
}

export interface CampaignContentGenerator {
  generate(input: {
    readonly workspaceId: string;
    readonly channel: ProspectingChannel;
    readonly icpName: string;
    readonly problems: unknown;
    readonly signals: unknown;
    readonly policy: {
      readonly language: "auto" | "fr" | "en";
      readonly firstMessageInstructions: string | null;
      readonly followUpInstructions: string | null;
    } | null;
    readonly prospect: {
      readonly firstName: string;
      readonly lastName: string;
      readonly headline: string | null;
      readonly companyName: string;
      readonly location: string | null;
      readonly score: number;
      readonly scoreExplanation: unknown;
      readonly publicEvidence: unknown;
    };
    readonly templateSteps: readonly SequenceStepInput[];
  }): Promise<PersonalizedCampaignContent>;
}

export interface CampaignChannelReadiness {
  resolveHealthyAccount(channel: ProspectingChannel): Promise<{
    readonly provider: "unipile";
    readonly accountId: string;
  }>;
}
