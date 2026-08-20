import { describe, expect, test } from "bun:test";
import { createContentIdeaHttpHandler } from "@outbound/interface/http/content-idea-handler";

const workspaceId = "30000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000002";

describe("Noosphere content idea HTTP", () => {
  test("derives tenant and user from the session and rejects body impersonation", async () => {
    const calls: unknown[] = [];
    const handler = createContentIdeaHttpHandler({ contextResolver: context("operator"), application: { async discover(input: unknown) { calls.push(input); return run(); } } as never });
    expect((await handler(request("/api/v1/content/ideas/discover", "POST", { requestKey: "idea-request-1", workspaceId: crypto.randomUUID() }))).status).toBe(422);
    expect((await handler(request("/api/v1/content/ideas/discover", "POST", { requestKey: "idea-request-2" }))).status).toBe(202);
    expect(calls).toEqual([{ workspaceId, userId, requestKey: "idea-request-2" }]);
  });

  test("lets viewers read but never launch research", async () => {
    const handler = createContentIdeaHttpHandler({ contextResolver: context("viewer"), application: { async list() { return { data: [], nextCursor: null }; } } as never });
    expect((await handler(request("/api/v1/content/ideas?limit=20"))).status).toBe(200);
    expect((await handler(request("/api/v1/content/ideas/discover", "POST", { requestKey: "idea-request-3" }))).status).toBe(403);
  });

  test("reports a missing active strategy as a recoverable conflict", async () => {
    const handler = createContentIdeaHttpHandler({ contextResolver: context("owner"), application: { async discover() { throw new Error("CONTENT_IDEA_ACTIVE_STRATEGY_REQUIRED"); } } as never });
    const response = await handler(request("/api/v1/content/ideas/discover", "POST", { requestKey: "idea-request-4" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("CONTENT_IDEA_ACTIVE_STRATEGY_REQUIRED");
  });
});

function context(role: "viewer" | "operator" | "owner") { return { async resolve() { return { workspaceId, userId, role }; } }; }
function request(path: string, method = "GET", body?: unknown) { return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function run() { return { id: crypto.randomUUID(), workspaceId, strategyVersionId: crypto.randomUUID(), status: "queued", trigger: "manual", cursor: 0, queryCount: 0, sourceCount: 0, ideaCount: 0, queryLimit: 3, sourceLimit: 40, deadlineAt: new Date(), lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), completedAt: null }; }
