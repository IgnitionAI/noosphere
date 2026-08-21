import { describe, expect, test } from "bun:test";
import { createContentStrategyHttpHandler } from "@outbound/interface/http/content-strategy-handler";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";

describe("Noosphere content strategy HTTP", () => {
  test("derives workspace and user exclusively from the authenticated session", async () => {
    const calls: unknown[] = [];
    const handler = createContentStrategyHttpHandler({
      contextResolver: context("operator"),
      application: {
        async find() { return null; },
        async derive(input: unknown) { calls.push(input); return strategy(); },
        async updateDraft() { return strategy(); },
        async publish() { return { id: crypto.randomUUID(), version: 1, publishedAt: new Date() }; },
      } as never,
    });
    const response = await handler(request("/api/v1/content/strategy/derive", "POST", { requestKey: "derive:request:1", workspaceId: crypto.randomUUID() }));
    expect(response.status).toBe(422);
    const accepted = await handler(request("/api/v1/content/strategy/derive", "POST", { requestKey: "derive:request:2" }));
    expect(accepted.status).toBe(201);
    expect(calls).toEqual([{ workspaceId, userId, requestKey: "derive:request:2" }]);
  });

  test("allows viewers to read but never mutate", async () => {
    const handler = createContentStrategyHttpHandler({ contextResolver: context("viewer"), application: { async find() { return strategy(); } } as never });
    expect((await handler(request("/api/v1/content/strategy"))).status).toBe(200);
    expect((await handler(request("/api/v1/content/strategy/derive", "POST", { requestKey: "derive:request:3" }))).status).toBe(403);
  });

  test("maps missing published grounding to a recoverable conflict", async () => {
    const handler = createContentStrategyHttpHandler({
      contextResolver: context("owner"),
      application: { async derive() { throw new Error("EDITORIAL_STRATEGY_OFFER_REQUIRED"); } } as never,
    });
    const response = await handler(request("/api/v1/content/strategy/derive", "POST", { requestKey: "derive:request:4" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("EDITORIAL_STRATEGY_OFFER_REQUIRED");
  });

  test("reports invalid model output as a recoverable upstream failure", async () => {
    const handler = createContentStrategyHttpHandler({
      contextResolver: context("owner"),
      application: { async derive() { throw new Error("EDITORIAL_STRATEGY_OUTPUT_INVALID"); } } as never,
    });
    const response = await handler(request("/api/v1/content/strategy/derive", "POST", { requestKey: "derive:request:invalid-model" }));
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("EDITORIAL_STRATEGY_OUTPUT_INVALID");
  });
});

function context(role: "viewer" | "operator" | "owner") { return { async resolve() { return { workspaceId, userId, role }; } }; }
function request(path: string, method = "GET", body?: unknown) { return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function strategy() { return { id: crypto.randomUUID(), workspaceId, name: "Strategy", offerId: crypto.randomUUID(), offerVersionId: crypto.randomUUID(), icpId: crypto.randomUUID(), icpVersionId: crypto.randomUUID(), currentVersion: 0, draft: { audience: { name: "Audience", summary: "Summary", awareness: "mixed" }, pillars: [{ name: "A", promise: "A", proofTypes: ["A"] }, { name: "B", promise: "B", proofTypes: ["B"] }, { name: "C", promise: "C", proofTypes: ["C"] }], voice: { traits: ["direct", "clair"], avoid: ["générique"] }, formats: ["linkedin_text"], cadence: { postsPerWeek: 3, preferredDays: [1, 3, 5], timezone: "Europe/Paris" }, callsToAction: ["Répondre"], allowedClaimIds: [], forbiddenTopics: [] }, derivation: { provider: "kimi-code", model: "k3", promptVersion: "v1", aiRunId: null }, createdAt: new Date(), updatedAt: new Date() }; }
