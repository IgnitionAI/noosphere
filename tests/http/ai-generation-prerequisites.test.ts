import { createCampaignHttpHandler } from "@outbound/interface/http/campaign-handler";
import { expect, test } from "bun:test";
import { ContentIdeaApplication } from "@outbound/application/content/content-ideas";
import { EditorialStrategyApplication } from "@outbound/application/content/editorial-strategy";
import { createContentIdeaHttpHandler } from "@outbound/interface/http/content-idea-handler";
import { createContentStrategyHttpHandler } from "@outbound/interface/http/content-strategy-handler";

const contextResolver = { async resolve() { return { workspaceId: "31000000-0000-4000-8000-000000000001", userId: "31000000-0000-4000-8000-000000000002", role: "owner" as const }; } };

test("missing AI rejects idea discovery and strategy derivation before queuing or invoking a provider", async () => {
  let effects = 0;
  const ideas = new ContentIdeaApplication({
    async findRequest() { return null; },
    async createDiscovery() { effects++; return {}; },
  } as never, async () => false);
  const strategy = new EditorialStrategyApplication({
    async findRequest() { return null; },
    async grounding() { effects++; throw new Error("must not request grounding"); },
  } as never, { async generate() { effects++; throw new Error("must not invoke provider"); } }, async () => false);
  const cases = [
    [createContentIdeaHttpHandler({ application: ideas, contextResolver }), "/api/v1/content/ideas/discover"],
    [createContentStrategyHttpHandler({ application: strategy, contextResolver }), "/api/v1/content/strategy/derive"],
  ] as const;
  for (const [handler, path] of cases) {
    const response = await handler(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestKey: "without-ai-request" }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "AI_SETUP_REQUIRED", setupUrl: "/settings/instance/ai" });
  }
  expect(effects).toBe(0);
});

test("missing AI rejects channel reassessment before mutating its checkpoint", async () => {
  const handler = createCampaignHttpHandler({ contextResolver, database: {} as never, jobQueue: {} as never, aiAvailable: async () => false });
  const response = await handler(new Request("http://localhost/api/v1/channel-assessments/31000000-0000-4000-8000-000000000003/actions/retry", { method: "POST" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "AI_SETUP_REQUIRED" });
});
