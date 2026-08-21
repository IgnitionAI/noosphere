import type { ProspectDecisionProposal } from "@outbound/domain/campaigns/prospect-decision";
import type { SocialProspectSignalAssessment } from "@outbound/domain/crm/social-prospect-signal";

export const PROSPECT_DECISION_JOB_TYPE = "prospect.decision.execute";

export interface ProspectDecisionState {
  readonly workspaceId: string;
  readonly decisionId: string;
  readonly kind: string;
  readonly reason: string;
  readonly dueAt: Date;
  readonly contact: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
  };
  readonly campaign: {
    readonly id: string;
    readonly status: string;
    readonly channel: string | null;
    readonly executionMode: "dry_run" | "live";
  } | null;
  readonly outreachAction: {
    readonly id: string;
    readonly status: string;
    readonly stepPosition: number;
    readonly stepKind: string;
    readonly channel: string;
    readonly dueAt: Date;
  } | null;
  readonly latestMessages: readonly {
    readonly direction: string;
    readonly body: string;
    readonly occurredAt: Date;
  }[];
  readonly sentTouches: number;
  readonly suppressed: boolean;
  readonly socialSignalAssessment: SocialProspectSignalAssessment;
}

export interface ProspectDecisionAgent {
  decide(state: ProspectDecisionState): Promise<ProspectDecisionProposal>;
}

export interface ScheduleProspectDecisionInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly campaignId?: string | null;
  readonly outreachActionId?: string | null;
  readonly kind: string;
  readonly reason: string;
  readonly dueAt: Date;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}
