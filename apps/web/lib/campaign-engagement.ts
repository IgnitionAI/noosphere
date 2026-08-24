import type {
  CampaignEngagementOverview,
  CampaignProspectEngagement,
  ProspectEngagementState,
} from "./api";

export interface AggregatedCampaignEngagement {
  readonly metrics: CampaignEngagementOverview["metrics"];
  readonly prospects: readonly CampaignProspectEngagement[];
}

const STATE_RANK: Record<ProspectEngagementState, number> = {
  not_contacted: 0,
  sent: 1,
  replied: 2,
  qualified: 3,
  refused: 4,
  meeting: 5,
};

export function aggregateCampaignEngagement(
  overviews: readonly CampaignEngagementOverview[],
): AggregatedCampaignEngagement {
  const byProspect = new Map<string, CampaignProspectEngagement>();
  for (const overview of overviews) {
    for (const prospect of overview.prospects) {
      const key = prospect.contactId ?? `candidate:${prospect.candidateId}`;
      const current = byProspect.get(key);
      if (!current) {
        byProspect.set(key, prospect);
        continue;
      }
      const winner = STATE_RANK[prospect.state] > STATE_RANK[current.state]
        || (
          STATE_RANK[prospect.state] === STATE_RANK[current.state]
          && Date.parse(prospect.lastActivityAt) > Date.parse(current.lastActivityAt)
        )
        ? prospect
        : current;
      const other = winner === prospect ? current : prospect;
      byProspect.set(key, {
        ...winner,
        conversationId: winner.conversationId ?? other.conversationId,
        decision: winner.decision ?? other.decision,
        automatedReply: winner.automatedReply ?? other.automatedReply,
        enrollment: winner.enrollment ?? other.enrollment,
        opportunity: winner.opportunity ?? other.opportunity,
        sentCount: current.sentCount + prospect.sentCount,
        pendingFollowUps: current.pendingFollowUps + prospect.pendingFollowUps,
        cancelledFollowUps: current.cancelledFollowUps + prospect.cancelledFollowUps,
        relaunchesCancelled: current.relaunchesCancelled || prospect.relaunchesCancelled,
      });
    }
  }
  const prospects = Array.from(byProspect.values()).sort(
    (left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt),
  );
  return {
    metrics: {
      targeted: prospects.filter((prospect) => prospect.eligible).length,
      contacted: prospects.filter((prospect) => prospect.sentCount > 0).length,
      replies: prospects.filter((prospect) => ["replied", "qualified", "refused", "meeting"].includes(prospect.state)).length,
      hot: prospects.filter((prospect) => ["qualified", "meeting"].includes(prospect.state)).length,
      meetings: prospects.filter((prospect) => prospect.state === "meeting").length,
    },
    prospects,
  };
}
