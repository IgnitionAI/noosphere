import { describe, expect, test } from "bun:test";
import { EditorialLearningApplication } from "@outbound/application/content/editorial-learning";
import { createEditorialLearningHttpHandler } from "@outbound/interface/http/editorial-learning-handler";

const workspaceId = crypto.randomUUID();
const view = { id: crypto.randomUUID(), workspaceId, strategyId: crypto.randomUUID(), strategyVersionId: crypto.randomUUID(), version: 1, facts: [], inferences: [], recommendations: [], bounds: { icpVersionId: crypto.randomUUID(), allowedPillars: [], allowedClaimIds: [], formats: ["linkedin_text"], postsPerWeek: 3 }, modelVersion: "bounded-editorial-learning-v1", windowStartedAt: new Date(), windowEndedAt: new Date(), createdAt: new Date() };

describe("AUT-102 editorial learning HTTP", () => {
  test("derives the workspace exclusively from session context", async () => {
    const reads: string[] = [];
    const handler = createEditorialLearningHttpHandler({
      application: new EditorialLearningApplication({ async latest(id: string) { reads.push(id); return view; } } as never),
      contextResolver: { async resolve() { return { workspaceId, userId: crypto.randomUUID(), role: "viewer" as const }; } },
    });
    const response = await handler(new Request("http://localhost/api/v1/content/learning?workspaceId=attacker", { method: "GET" }));
    expect(response.status).toBe(200);
    expect(reads).toEqual([workspaceId]);
  });

  test("returns a clear empty state without leaking another workspace", async () => {
    const handler = createEditorialLearningHttpHandler({
      application: new EditorialLearningApplication({ async latest() { return null; } } as never),
      contextResolver: { async resolve() { return { workspaceId, userId: crypto.randomUUID(), role: "owner" as const }; } },
    });
    const response = await handler(new Request("http://localhost/api/v1/content/learning", { method: "GET" }));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("EDITORIAL_LEARNING_NOT_FOUND");
  });
});
