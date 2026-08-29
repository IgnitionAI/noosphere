import type { McpExecutionContext } from "./mcp-read-capabilities";
export type { McpExecutionContext } from "./mcp-read-capabilities";

export const MCP_GOVERNED_EFFECT_KINDS = [
  "conversation_reply",
  "content_publication",
  "meeting_proposal",
  "campaign_activation",
] as const;

export type McpGovernedEffectKind = (typeof MCP_GOVERNED_EFFECT_KINDS)[number];

export const MCP_GOVERNED_EFFECT_STATUSES = [
  "approval_required",
  "policy_denied",
  "queued",
  "accepted",
  "unknown",
  "reconciling",
  "delivered",
  "failed",
  "rejected",
  "invalidated",
] as const;

export type McpGovernedEffectStatus = (typeof MCP_GOVERNED_EFFECT_STATUSES)[number];

export const MCP_EFFECT_TERMINAL_STATUSES = [
  "policy_denied",
  "delivered",
  "failed",
  "rejected",
  "invalidated",
] as const satisfies readonly McpGovernedEffectStatus[];

export const MCP_GOVERNED_EFFECT_TERMINAL_STATUSES = MCP_EFFECT_TERMINAL_STATUSES;

export type McpEffectTerminalStatus = (typeof MCP_EFFECT_TERMINAL_STATUSES)[number];

export const MCP_EFFECT_TRACE_STAGES = [
  "proposal",
  "approval",
  "policy",
  "outbox",
  "attempt",
  "result",
] as const;

export type McpEffectTraceStage = (typeof MCP_EFFECT_TRACE_STAGES)[number];

export const MCP_RECONCILIATION_STATUSES = [
  "pending",
  "searching",
  "matched",
  "not_found",
  "ambiguous",
  "error",
] as const;

export type McpReconciliationStatus = (typeof MCP_RECONCILIATION_STATUSES)[number];

export const MCP_RECONCILIATION_TO_PROPOSAL_STATUS: Readonly<Record<McpReconciliationStatus, McpGovernedEffectStatus>> = Object.freeze({
  pending: "reconciling",
  searching: "reconciling",
  matched: "delivered",
  not_found: "failed",
  ambiguous: "reconciling",
  error: "reconciling",
});

export interface McpEffectProposal {
  readonly proposalId: string;
  readonly workspaceId: string;
  readonly kind: McpGovernedEffectKind;
  readonly status: McpGovernedEffectStatus;
  readonly approvalItemId: string | null;
  readonly correlationId: string;
  readonly version: number;
  readonly revision: number;
  readonly sourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpReviewerIntentProjection {
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly body?: string;
  readonly subject?: string;
  readonly slotStart?: string;
  readonly slotEnd?: string;
  readonly timeZone?: string;
  readonly revision: number;
  readonly sourceVersion: number;
}

export interface McpEffectStatusView extends McpEffectProposal {
  readonly policyCode: string | null;
  readonly operationId: string | null;
  readonly jobId: string | null;
  readonly reconciliationId: string | null;
  readonly approvalDecision: "approve" | "reject" | null;
  /** Only a fresh reviewer/admin/owner approval projection may populate this value. */
  readonly intent: McpReviewerIntentProjection | null;
  readonly redacted: boolean;
}

export type McpPrepareCommand =
  | {
    readonly kind: "conversation_reply";
    readonly requestKey: string;
    readonly inputHash: string;
    readonly conversationId: string;
    readonly body: string;
    readonly expectedVersion?: number;
  }
  | {
    readonly kind: "content_publication";
    readonly requestKey: string;
    readonly inputHash: string;
    readonly assetId: string;
    readonly assetVersionId?: string;
    readonly scheduledFor?: string;
    readonly expectedVersion?: number;
  }
  | {
    readonly kind: "meeting_proposal";
    readonly requestKey: string;
    readonly inputHash: string;
    readonly meetingProposalId: string;
    readonly slotPosition: number;
    readonly expectedVersion?: number;
  }
  | {
    readonly kind: "campaign_activation";
    readonly requestKey: string;
    readonly inputHash: string;
    readonly campaignId: string;
    readonly expectedVersion?: number;
  };

export interface McpGovernedEffectCapabilities {
  prepare(context: McpExecutionContext, command: McpPrepareCommand): Promise<McpEffectProposal>;
  list(
    context: McpExecutionContext,
    input: { readonly status?: McpGovernedEffectStatus; readonly limit: number },
  ): Promise<readonly McpEffectStatusView[]>;
  status(
    context: McpExecutionContext,
    input: { readonly proposalId?: string; readonly approvalItemId?: string },
  ): Promise<McpEffectStatusView | null>;
  decide(
    context: McpExecutionContext,
    input: { readonly approvalItemId: string; readonly decision: "approve" | "reject"; readonly justification?: string },
  ): Promise<McpEffectStatusView>;
}

export interface ExternalEffectPolicyInput {
  readonly context: McpExecutionContext;
  readonly proposal: McpEffectProposal;
  readonly phase: "preview" | "final";
}

export interface ExternalEffectPolicyResult {
  readonly decision: "allow" | "deny";
  readonly code: string;
  readonly factsVersion: number;
}

/** Provider-free policy port. Implementations belong to later application/infrastructure slices. */
export interface ExternalEffectPolicy {
  preview(input: ExternalEffectPolicyInput): Promise<ExternalEffectPolicyResult>;
  final(input: ExternalEffectPolicyInput): Promise<ExternalEffectPolicyResult>;
}

export type McpGovernedEffectTransition =
  | { readonly type: "approve" }
  | { readonly type: "reject" }
  | { readonly type: "policy_deny" }
  | { readonly type: "invalidate" }
  | { readonly type: "accepted" }
  | { readonly type: "unknown" }
  | { readonly type: "reconcile"; readonly status: McpReconciliationStatus };

/**
 * Translate a read-only reconciliation observation into a proposal state.
 * A missing record is deliberately different from a failed lookup.
 */
export function mapMcpReconciliationToProposalStatus(
  reconciliation: McpReconciliationStatus | null,
): McpGovernedEffectStatus {
  if (reconciliation === null) return "unknown";
  return MCP_RECONCILIATION_TO_PROPOSAL_STATUS[reconciliation];
}

export const mapMcpReconciliationStatus = mapMcpReconciliationToProposalStatus;
export const reconciliationStatusToProposalStatus = mapMcpReconciliationToProposalStatus;

/**
 * Apply one explicit state-machine event. `null` means the event is not a
 * legal transition; callers must not infer delivery from an illegal event.
 */
export function transitionMcpGovernedEffect(
  current: McpGovernedEffectStatus,
  event: McpGovernedEffectTransition,
): McpGovernedEffectStatus | null {
  if (isMcpGovernedEffectTerminalStatus(current)) return null;
  switch (current) {
    case "approval_required":
      if (event.type === "approve") return "queued";
      if (event.type === "reject") return "rejected";
      if (event.type === "policy_deny") return "policy_denied";
      if (event.type === "invalidate") return "invalidated";
      return null;
    case "queued":
      if (event.type === "accepted") return "accepted";
      if (event.type === "unknown") return "unknown";
      if (event.type === "reject") return "rejected";
      if (event.type === "policy_deny") return "policy_denied";
      if (event.type === "invalidate") return "invalidated";
      return null;
    case "accepted":
      if (event.type === "unknown") return "unknown";
      if (event.type === "reject") return "rejected";
      if (event.type === "policy_deny") return "policy_denied";
      if (event.type === "invalidate") return "invalidated";
      return null;
    case "unknown":
    case "reconciling":
      if (event.type !== "reconcile") return null;
      return mapMcpReconciliationToProposalStatus(event.status);
    default:
      return null;
  }
}

export const transitionMcpEffectStatus = transitionMcpGovernedEffect;

export function isMcpGovernedEffectTerminalStatus(
  status: McpGovernedEffectStatus,
): status is McpEffectTerminalStatus {
  return (MCP_EFFECT_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export const isMcpEffectTerminalStatus = isMcpGovernedEffectTerminalStatus;
