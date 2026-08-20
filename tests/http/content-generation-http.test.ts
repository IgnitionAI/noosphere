import { describe, expect, test } from "bun:test";
import { createContentGenerationHttpHandler } from "@outbound/interface/http/content-generation-handler";

const workspaceId = "31000000-0000-4000-8000-000000000001";
const userId = "31000000-0000-4000-8000-000000000002";
const ideaId = "31000000-0000-4000-8000-000000000003";
const assetId = "31000000-0000-4000-8000-000000000004";

describe("Noosphere content generation HTTP", () => {
  test("derives tenant and user from the session and rejects body impersonation", async () => {
    const calls: unknown[] = [];
    const handler = createContentGenerationHttpHandler({ contextResolver: context("operator"), application: { async generate(input: unknown) { calls.push(input); return run(); } } as never });
    expect((await handler(request(`/api/v1/content/ideas/${ideaId}/brief`, "POST", { requestKey: "content-request-1", workspaceId }))).status).toBe(422);
    expect((await handler(request(`/api/v1/content/ideas/${ideaId}/brief`, "POST", { requestKey: "content-request-2" }))).status).toBe(202);
    expect(calls).toEqual([{ workspaceId, userId, ideaId, requestKey: "content-request-2" }]);
  });

  test("lets viewers inspect evidence and content but never generate or improve", async () => {
    const handler = createContentGenerationHttpHandler({ contextResolver: context("viewer"), application: { async findIdea() { return { id: ideaId }; }, async findAssetByIdea() { return null; } } as never });
    expect((await handler(request(`/api/v1/content/ideas/${ideaId}`))).status).toBe(200);
    expect((await handler(request(`/api/v1/content/ideas/${ideaId}/brief`, "POST", { requestKey: "content-request-3" }))).status).toBe(403);
    expect((await handler(request(`/api/v1/content/assets/${assetId}/improve`, "POST", { requestKey: "content-request-4" }))).status).toBe(403);
  });

  test("accepts an improvement instruction but exposes no schedule or publish route", async () => {
    const calls: unknown[] = [];
    const handler = createContentGenerationHttpHandler({ contextResolver: context("owner"), application: { async improve(input: unknown) { calls.push(input); return run(); } } as never });
    expect((await handler(request(`/api/v1/content/assets/${assetId}/improve`, "POST", { requestKey: "content-request-5", instruction: "Rendre le hook plus concret" }))).status).toBe(202);
    expect(calls).toEqual([{ workspaceId, userId, assetId, requestKey: "content-request-5", instruction: "Rendre le hook plus concret" }]);
    expect((await handler(request(`/api/v1/content/assets/${assetId}/publish`, "POST", { requestKey: "content-request-6" }))).status).toBe(405);
  });
});

function context(role: "viewer" | "operator" | "owner") { return { async resolve() { return { workspaceId, userId, role }; } }; }
function request(path: string, method = "GET", body?: unknown) { return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function run() { return { id: crypto.randomUUID(), workspaceId, ideaId, assetId, assetVersionId: null, status: "queued", stage: "brief", instruction: null, lastErrorCode: null, lastErrorMessage: null, createdAt: new Date(), completedAt: null }; }
