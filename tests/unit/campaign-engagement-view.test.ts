import { describe, expect, test } from "bun:test";
import { aggregateCampaignEngagement } from "../../apps/web/lib/campaign-engagement";
import type { CampaignEngagementOverview } from "../../apps/web/lib/api";

function overview(campaignId: string, state: "sent" | "meeting", activity: string): CampaignEngagementOverview {
  return {
    campaignId,
    metrics: { targeted: 1, contacted: 1, replies: state === "meeting" ? 1 : 0, hot: state === "meeting" ? 1 : 0, meetings: state === "meeting" ? 1 : 0 },
    prospects: [{
      campaignId,
      candidateId: `candidate-${campaignId}`,
      contactId: "contact-1",
      conversationId: state === "meeting" ? "conversation-1" : null,
      fullName: "Marie Durand",
      headline: "Directrice juridique",
      companyName: "Acme",
      score: 80,
      eligible: true,
      state,
      lastMessage: null,
      lastActivityAt: activity,
      decision: null,
      automatedReply: null,
      enrollment: null,
      sentCount: 1,
      pendingFollowUps: state === "sent" ? 1 : 0,
      cancelledFollowUps: state === "meeting" ? 1 : 0,
      relaunchesCancelled: state === "meeting",
      opportunity: state === "meeting" ? { stage: "meeting_requested", nextAction: null } : null,
    }],
  };
}

describe("campaign engagement web projection", () => {
  test("deduplicates one prospect across channels and keeps the most advanced state", () => {
    const aggregated = aggregateCampaignEngagement([
      overview("linkedin", "sent", "2026-08-02T10:00:00.000Z"),
      overview("email", "meeting", "2026-08-02T11:00:00.000Z"),
    ]);

    expect(aggregated.metrics).toEqual({ targeted: 1, contacted: 1, replies: 1, hot: 1, meetings: 1 });
    expect(aggregated.prospects).toHaveLength(1);
    expect(aggregated.prospects[0]).toMatchObject({
      campaignId: "email",
      state: "meeting",
      sentCount: 2,
      pendingFollowUps: 1,
      cancelledFollowUps: 1,
      relaunchesCancelled: true,
    });
  });
});
