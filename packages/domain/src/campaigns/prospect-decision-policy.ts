import type { ProspectDecisionProposal } from "./prospect-decision";

export type ProspectDecisionPolicyResult =
  | { readonly allowed: true; readonly requiresApproval: boolean; readonly executeAt: Date }
  | { readonly allowed: false; readonly code: string; readonly reason: string; readonly retryAt?: Date };

export interface ProspectDecisionPolicyState {
  readonly contactStatus: string;
  readonly suppressed: boolean;
  readonly campaign: { readonly status: string; readonly executionMode: "dry_run" | "live" } | null;
  readonly outreachAction: { readonly status: string; readonly dueAt: Date; readonly channel: string } | null;
  readonly openLinkedinConversation: boolean;
  readonly now: Date;
}

export function evaluateProspectDecisionPolicy(
  state: ProspectDecisionPolicyState,
  proposal: ProspectDecisionProposal,
): ProspectDecisionPolicyResult {
  if (proposal.action === "stop") {
    return { allowed: true, requiresApproval: false, executeAt: state.now };
  }
  if (state.contactStatus !== "active") {
    return { allowed: false, code: "PROSPECT_NOT_ACTIVE", reason: "Le prospect n’est plus actif." };
  }
  if (state.suppressed && ["send", "research", "wait"].includes(proposal.action)) {
    return { allowed: false, code: "PROSPECT_SUPPRESSED", reason: "Une suppression active interdit tout nouveau contact." };
  }
  if (proposal.action !== "send") {
    return { allowed: true, requiresApproval: proposal.action === "handoff", executeAt: state.now };
  }
  if (state.openLinkedinConversation && state.outreachAction?.channel === "linkedin") {
    return {
      allowed: false,
      code: "LINKEDIN_CONVERSATION_ALREADY_OPEN",
      reason: "Une conversation LinkedIn est déjà ouverte : le DM froid planifié est annulé au profit du fil existant.",
    };
  }
  if (!state.campaign || state.campaign.status !== "active") {
    return { allowed: false, code: "CAMPAIGN_NOT_ACTIVE", reason: "La campagne n’est pas active." };
  }
  if (!state.outreachAction || state.outreachAction.status !== "scheduled") {
    return { allowed: false, code: "OUTREACH_ACTION_NOT_SENDABLE", reason: "L’action outbound n’est plus envoyable." };
  }
  if (state.outreachAction.dueAt > state.now) {
    return {
      allowed: false,
      code: "OUTREACH_ACTION_NOT_DUE",
      reason: "L’action outbound n’est pas encore arrivée à échéance.",
      retryAt: state.outreachAction.dueAt,
    };
  }
  return {
    allowed: true,
    requiresApproval: state.campaign.executionMode === "dry_run",
    executeAt: state.now,
  };
}
