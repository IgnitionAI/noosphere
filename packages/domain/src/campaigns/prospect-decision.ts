export const PROSPECT_DECISION_ACTIONS = [
  "send",
  "wait",
  "research",
  "pause",
  "stop",
  "handoff",
] as const;

export type ProspectDecisionAction = (typeof PROSPECT_DECISION_ACTIONS)[number];

export interface ProspectDecisionProposal {
  readonly observation: string;
  readonly action: ProspectDecisionAction;
  readonly reason: string;
  readonly nextDueAt: string | null;
  readonly nextReason: string | null;
}

export function assertProspectDecisionProposal(
  proposal: ProspectDecisionProposal,
  now: Date,
): ProspectDecisionProposal {
  if (!proposal.observation.trim()) throw new Error("PROSPECT_DECISION_OBSERVATION_REQUIRED");
  if (!proposal.reason.trim()) throw new Error("PROSPECT_DECISION_REASON_REQUIRED");
  if (proposal.action === "wait" && !proposal.nextDueAt) {
    throw new Error("PROSPECT_DECISION_NEXT_DATE_REQUIRED");
  }
  if (proposal.nextDueAt) {
    const next = new Date(proposal.nextDueAt);
    if (Number.isNaN(next.getTime()) || next <= now) {
      throw new Error("PROSPECT_DECISION_NEXT_DATE_INVALID");
    }
    if (!proposal.nextReason?.trim()) throw new Error("PROSPECT_DECISION_NEXT_REASON_REQUIRED");
  }
  return proposal;
}
