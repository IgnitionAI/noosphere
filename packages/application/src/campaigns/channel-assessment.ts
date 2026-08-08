import type {
  ChannelAssessmentMetrics,
  ProspectingChannel,
} from "@outbound/domain/campaigns/prospecting-plan";

export interface ChannelStrategy {
  readonly query: string;
  readonly sourceKinds: readonly (
    | "linkedin"
    | "web"
    | "maps"
    | "official_registry"
    | "professional_directory"
    | "jobs"
    | "news"
  )[];
  readonly rationale: string;
  readonly sampleSize: number;
}

export interface ChannelAssessmentEvidence {
  readonly url: string | null;
  readonly title: string;
  readonly excerpt: string;
  readonly kind: "profile" | "account" | "email" | "phone" | "whatsapp";
}

export interface ChannelObservation {
  readonly metrics: ChannelAssessmentMetrics;
  readonly evidence: readonly ChannelAssessmentEvidence[];
}

export interface ChannelStrategyPlanner {
  plan(input: {
    readonly channel: ProspectingChannel;
    readonly icpName: string;
    readonly criteria: unknown;
    readonly buyingCommittee: unknown;
    readonly signals: unknown;
  }): Promise<ChannelStrategy>;
}

export interface ChannelObservationSource {
  observe(input: {
    readonly workspaceId: string;
    readonly assessmentId: string;
    readonly channel: ProspectingChannel;
    readonly strategy: ChannelStrategy;
    readonly version: { readonly criteria: unknown; readonly buyingCommittee: unknown };
  }): Promise<ChannelObservation>;
}
