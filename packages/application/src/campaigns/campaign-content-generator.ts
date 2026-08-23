import type { ProspectingChannel } from "@outbound/domain/campaigns/prospecting-plan";
import type { SequenceStepInput } from "@outbound/domain/campaigns/sequence-validation";
import type {
  CampaignMessageHistoryItem,
  CampaignStepObjective,
} from "@outbound/domain/campaigns/campaign-editorial-context";

export interface CampaignOfferEditorialContext {
  readonly source: "offer_version" | "research_brief" | "unavailable";
  readonly name: string;
  readonly category: string | null;
  readonly valueProposition: string;
  readonly targetAudience: string;
  readonly pricing: unknown;
  readonly commercialRules: unknown;
  readonly constraints: unknown;
  readonly objections: unknown;
  readonly claims: readonly {
    readonly id: string;
    readonly claim: string;
    readonly validationStatus: "sourced" | "validated";
    readonly evidenceUri: string | null;
  }[];
}

export interface CampaignEditorialContext {
  readonly campaignObjective: string;
  readonly offer: CampaignOfferEditorialContext;
  readonly prospectEvidence: {
    readonly publicData: unknown;
    readonly scoreFactors: unknown;
  };
  readonly previousMessages: readonly CampaignMessageHistoryItem[];
  readonly stepObjective: CampaignStepObjective;
}

export interface CampaignEditorialContextReader {
  read(input: {
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly contactId: string;
    readonly step: Pick<SequenceStepInput, "position" | "kind">;
    readonly totalSteps: number;
    readonly prospectEvidence: CampaignEditorialContext["prospectEvidence"];
  }): Promise<CampaignEditorialContext>;
}

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
    readonly aiConfigurationId?: string;
    readonly promptVersionId?: string;
    readonly aiRunId?: string;
    readonly knowledgeClaimIds?: readonly string[];
    readonly knowledgeSourceIds?: readonly string[];
    readonly offerClaimIds?: readonly string[];
    readonly editorialReview?: {
      readonly verdict: "approved" | "revised";
      readonly genericityScore: number;
      readonly issues: readonly string[];
      readonly changesApplied: readonly string[];
      readonly evidenceAnchor: string;
    };
    readonly memoryReceiptId?: string;
    readonly memorySnapshotId?: string | null;
    readonly memorySnapshotVersion?: number | null;
    readonly memoryWatermark?: number;
  };
}

export interface CampaignContentGenerator {
  generate(input: {
    readonly workspaceId: string;
    readonly channel: ProspectingChannel;
    readonly campaignObjective: string;
    readonly icpName: string;
    readonly problems: unknown;
    readonly signals: unknown;
    readonly offer: CampaignOfferEditorialContext;
    readonly previousMessages: readonly CampaignMessageHistoryItem[];
    readonly stepObjective: CampaignStepObjective;
    readonly policy: {
      readonly language: "auto" | "fr" | "en";
      readonly firstMessageInstructions: string | null;
      readonly followUpInstructions: string | null;
    } | null;
    readonly prospect: {
      /** Internal durable contact identity. It is never included in model input. */
      readonly contactId: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly headline: string | null;
      readonly companyName: string;
      readonly location: string | null;
      readonly score: number;
      readonly scoreExplanation: unknown;
      readonly evidence: {
        readonly publicData: unknown;
        readonly scoreFactors: unknown;
      };
    };
    readonly templateSteps: readonly SequenceStepInput[];
  }): Promise<PersonalizedCampaignContent>;
}

export interface CampaignChannelReadiness {
  resolveHealthyAccount(workspaceId: string, channel: ProspectingChannel): Promise<{
    readonly provider: "unipile";
    readonly accountId: string;
  }>;
}
