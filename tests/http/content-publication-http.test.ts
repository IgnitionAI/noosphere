import { describe, expect, test } from "bun:test";
import { createContentPublicationHttpHandler } from "@outbound/interface/http/content-publication-handler";

const workspaceId = "32000000-0000-4000-8000-000000000001";
const userId = "32000000-0000-4000-8000-000000000002";
const assetId = "32000000-0000-4000-8000-000000000003";
const publicationId = "32000000-0000-4000-8000-000000000004";

describe("Noosphere durable content publication HTTP", () => {
  test("derives workspace and user from the session for a durable schedule", async () => {
    const calls: unknown[] = [];
    const handler = createContentPublicationHttpHandler({
      contextResolver: context("operator"),
      application: { async schedule(input: unknown) { calls.push(input); return publication(); } } as never,
    });
    const scheduledFor = "2026-08-21T08:00:00.000Z";
    expect((await handler(request(`/api/v1/content/assets/${assetId}/schedule`, "POST", { requestKey: "schedule-fixture-1", scheduledFor, workspaceId }))).status).toBe(422);
    expect((await handler(request(`/api/v1/content/assets/${assetId}/schedule`, "POST", { requestKey: "schedule-fixture-2", scheduledFor }))).status).toBe(202);
    expect(calls).toEqual([{ workspaceId, userId, assetId, requestKey: "schedule-fixture-2", scheduledFor: new Date(scheduledFor) }]);
  });

  test("allows viewers to read but never schedule, move or cancel", async () => {
    const handler = createContentPublicationHttpHandler({
      contextResolver: context("viewer"),
      application: { async list() { return { data: [], nextCursor: null }; }, async find() { return publication(); } } as never,
    });
    expect((await handler(request("/api/v1/content/publications"))).status).toBe(200);
    expect((await handler(request(`/api/v1/content/publications/${publicationId}`))).status).toBe(200);
    expect((await handler(request(`/api/v1/content/assets/${assetId}/schedule`, "POST", { requestKey: "schedule-fixture-3", scheduledFor: "2026-08-21T08:00:00.000Z" }))).status).toBe(403);
    expect((await handler(request(`/api/v1/content/publications/${publicationId}/cancel`, "POST", { requestKey: "cancel-fixture-1" }))).status).toBe(403);
  });

  test("moves and cancels through explicit idempotent actions", async () => {
    const calls: unknown[] = [];
    const handler = createContentPublicationHttpHandler({
      contextResolver: context("owner"),
      application: {
        async reschedule(input: unknown) { calls.push(input); return publication(); },
        async cancel(input: unknown) { calls.push(input); return { ...publication(), status: "cancelled" }; },
      } as never,
    });
    const scheduledFor = "2026-08-22T09:00:00.000Z";
    expect((await handler(request(`/api/v1/content/publications/${publicationId}/reschedule`, "POST", { requestKey: "move-fixture-1", scheduledFor }))).status).toBe(200);
    expect((await handler(request(`/api/v1/content/publications/${publicationId}/cancel`, "POST", { requestKey: "cancel-fixture-2" }))).status).toBe(200);
    expect(calls).toEqual([
      { workspaceId, userId, publicationId, requestKey: "move-fixture-1", scheduledFor: new Date(scheduledFor) },
      { workspaceId, userId, publicationId, requestKey: "cancel-fixture-2" },
    ]);
  });
});

function context(role: "viewer" | "operator" | "owner") { return { async resolve() { return { workspaceId, userId, role }; } }; }
function request(path: string, method = "GET", body?: unknown) { return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function publication() { return { id: publicationId, workspaceId, assetId, assetVersionId: crypto.randomUUID(), network: "linkedin", provider: "unipile", status: "scheduled", scheduledFor: new Date(), contentSnapshot: { assetVersionId: crypto.randomUUID(), body: "Fixture", contentHash: "hash" }, policySnapshot: { schemaVersion: 1, policyVersion: "linkedin-publishing-v1", network: "linkedin", assetReady: true, strategyVersionId: crypto.randomUUID(), claimsGate: "passed" }, accountSnapshot: { provider: "unipile", providerAccountId: "account_fixture", displayName: "Fixture", selectionVersion: new Date().toISOString(), observedAt: new Date().toISOString() }, attempts: 0, maxAttempts: 4, providerPostId: null, providerSocialId: null, providerUrl: null, lastErrorCode: null, lastErrorMessage: null, publishedAt: null, cancelledAt: null, unknownAt: null, reconciliation: null, createdAt: new Date(), updatedAt: new Date() }; }
