import { describe, expect, test } from "bun:test";
import { createOperationalViewHttpHandler, type OperationalViewsPort } from "@outbound/interface/http/operational-view-handler";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignId = "22222222-2222-4222-8222-222222222222";

describe("workspace operational view HTTP routes", () => {
  test("derives every read from the authenticated workspace and keeps filters", async () => {
    const calls: string[] = [];
    const views = fakeViews(calls);
    const handler = createOperationalViewHttpHandler({ contextResolver: context("viewer"), database: undefined as never, views });

    const summary = await handler(new Request("http://localhost/api/v1/workspace/operational-summary"));
    expect(summary.status).toBe(200);
    expect(calls).toEqual([`summary:${workspaceId}`]);

    const activity = await handler(new Request("http://localhost/api/v1/activity?lens=outbound&cursor=25"));
    expect(activity.status).toBe(200);
    expect(calls.at(-1)).toBe(`activity:${workspaceId}:outbound:all:25`);

    const replies = await handler(new Request("http://localhost/api/v1/activity?lens=inbound&interactionType=reply"));
    expect(replies.status).toBe(200);
    expect(calls.at(-1)).toBe(`activity:${workspaceId}:inbound:reply:0`);

    const conversations = await handler(new Request("http://localhost/api/v1/conversations?channel=linkedin&scope=outside_campaign&source=inbound&page=2&pageSize=10&search=salim"));
    expect(conversations.status).toBe(200);
    expect(calls.at(-1)).toBe(`conversations:${workspaceId}:linkedin:outside_campaign:inbound:salim:2:10`);
  });

  test("exposes campaign and pipeline projections while rejecting invalid methods", async () => {
    const handler = createOperationalViewHttpHandler({ contextResolver: context("viewer"), database: undefined as never, views: fakeViews([]) });
    const campaign = await handler(new Request(`http://localhost/api/v1/campaigns/${campaignId}/workspace-view`));
    expect(campaign.status).toBe(200);
    const pipeline = await handler(new Request("http://localhost/api/v1/pipeline/view"));
    expect(pipeline.status).toBe(200);
    const invalid = await handler(new Request("http://localhost/api/v1/pipeline/view", { method: "POST" }));
    expect(invalid.status).toBe(405);
  });

  test("fails closed for a viewer without workspace context", async () => {
    const handler = createOperationalViewHttpHandler({ contextResolver: { async resolve() { throw new Error("WORKSPACE_FORBIDDEN"); } }, database: undefined as never, views: fakeViews([]) });
    const response = await handler(new Request("http://localhost/api/v1/workspace/setup-readiness"));
    expect(response.status).toBe(403);
  });

  test("rejects unknown conversation filters instead of silently broadening the query", async () => {
    const handler = createOperationalViewHttpHandler({ contextResolver: context("viewer"), database: undefined as never, views: fakeViews([]) });
    const response = await handler(new Request("http://localhost/api/v1/conversations?channel=carrier-pigeon"));
    expect(response.status).toBe(422);
    const invalidSource = await handler(new Request("http://localhost/api/v1/conversations?source=viral"));
    expect(invalidSource.status).toBe(422);
  });

  test("treats the Noosphere Axis as read-only projection navigation", async () => {
    const calls: string[] = [];
    const handler = createOperationalViewHttpHandler({ contextResolver: context("viewer"), database: undefined as never, views: fakeViews(calls) });
    for (const lens of ["inbound", "symbiosis", "outbound"] as const) {
      const response = await handler(new Request(`http://localhost/api/v1/activity?lens=${lens}`));
      expect(response.status).toBe(200);
    }
    expect(calls).toEqual([
      `activity:${workspaceId}:inbound:all:0`,
      `activity:${workspaceId}:symbiosis:all:0`,
      `activity:${workspaceId}:outbound:all:0`,
    ]);
    const invalid = await handler(new Request("http://localhost/api/v1/activity?lens=command"));
    expect(invalid.status).toBe(422);
    const invalidType = await handler(new Request("http://localhost/api/v1/activity?lens=inbound&interactionType=shared"));
    expect(invalidType.status).toBe(422);
    const invalidLensCombination = await handler(new Request("http://localhost/api/v1/activity?lens=outbound&interactionType=reply"));
    expect(invalidLensCombination.status).toBe(422);
  });
});

function context(role: "viewer") {
  return { async resolve() { return { userId: crypto.randomUUID(), workspaceId, role }; } };
}

function fakeViews(calls: string[]): OperationalViewsPort {
  return {
    async getSummary(receivedWorkspaceId) { calls.push(`summary:${receivedWorkspaceId}`); return { asOf: new Date(), counts: { activeCampaigns: 0, prospects: 0, contactedProspects: 0, publishedContents: 0, openConversations: 0, openOpportunities: 0, bookedCalls: 0, attention: 0 }, attention: [], jobs: { active: 0, failed: 0, running: [] }, nextAutomaticResearch: null, accountHealth: { connected: 0, degraded: 0, disconnected: 0, activeAlerts: 0 }, engines: { inbound: { status: "not_configured", label: "Inbound", summary: "", lastActivityAt: null, nextAction: null }, outbound: { status: "idle", label: "Outbound", summary: "", lastActivityAt: null, nextAction: null } }, nextOutcomes: [], attentionPagination: { nextCursor: null } }; },
    async getActivity(input) { calls.push(`activity:${input.workspaceId}:${input.lens}:${input.interactionType ?? "all"}:${input.offset ?? 0}`); return { lens: input.lens, asOf: new Date(), state: "idle", quality: "fresh", headline: "", counters: [], items: [], pagination: { nextCursor: null } }; },
    async getSetupReadiness() { return { ready: true, asOf: new Date(), items: [] }; },
    async getCampaignView() { return { campaign: {}, autopilot: {}, population: { total: 0, eligible: 0, contacted: 0, replies: 0 }, timeline: [], nextAction: null } as never; },
    async listConversations(input) { calls.push(`conversations:${input.workspaceId}:${input.channel}:${input.scope}:${input.source}:${input.search}:${input.page}:${input.pageSize}`); return { data: [], pagination: { page: input.page, pageSize: input.pageSize, total: 0, hasNext: false }, sync: { totalAccounts: 0, readyAccounts: 0, backfillingAccounts: 0, errorAccounts: 0, lastSuccessAt: null } }; },
    async getConversation() { return null; },
    async getPipeline() { return { data: [] }; },
  };
}
