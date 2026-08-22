import { describe, expect, test } from "bun:test";
import { ContentPerformanceApplication } from "@outbound/application/content/content-performance";
import { createContentPerformanceHttpHandler } from "@outbound/interface/http/content-performance-handler";

const workspaceId = crypto.randomUUID();

describe("content performance HTTP", () => {
  test("derives the tenant from the session and exposes comparable format metrics", async () => {
    const reads: string[] = [];
    const observedAt = new Date("2026-08-22T08:00:00.000Z");
    const application = new ContentPerformanceApplication({
      async read(inputWorkspaceId) {
        reads.push(inputWorkspaceId);
        return {
          observedAt,
          formats: [{
            format: "linkedin_document",
            publications: 3,
            impressions: 1_000,
            reactions: 42,
            comments: 8,
            reposts: 5,
            engagementRate: 5.5,
          }],
        };
      },
    });
    const handler = createContentPerformanceHttpHandler({
      application,
      contextResolver: { async resolve() { return { userId: crypto.randomUUID(), workspaceId, role: "viewer" as const }; } },
    });

    const response = await handler(new Request("http://localhost/api/v1/content/performance?workspaceId=attacker"));
    expect(response.status).toBe(200);
    expect(reads).toEqual([workspaceId]);
    expect(await response.json()).toEqual({
      observedAt: observedAt.toISOString(),
      formats: [{
        format: "linkedin_document",
        publications: 3,
        impressions: 1_000,
        reactions: 42,
        comments: 8,
        reposts: 5,
        engagementRate: 5.5,
      }],
    });
  });

  test("keeps the projection read-only", async () => {
    const handler = createContentPerformanceHttpHandler({
      application: new ContentPerformanceApplication({ async read() { throw new Error("must not read"); } }),
      contextResolver: { async resolve() { return { userId: crypto.randomUUID(), workspaceId, role: "owner" as const }; } },
    });
    const response = await handler(new Request("http://localhost/api/v1/content/performance", { method: "POST" }));
    expect(response.status).toBe(405);
  });
});
