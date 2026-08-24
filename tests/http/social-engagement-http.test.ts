import { describe, expect, test } from "bun:test";
import { createSocialEngagementHttpHandler } from "@outbound/interface/http/social-engagement-handler";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const workspaceId = "35000000-0000-4000-8000-000000000001";
const userId = "35000000-0000-4000-8000-000000000002";
const postId = "35000000-0000-4000-8000-000000000003";

describe("ENG-101 social engagement HTTP", () => {
  test("derives workspace from the session and preserves filters", async () => {
    const calls: unknown[] = [];
    const handler = createSocialEngagementHttpHandler({
      contextResolver: context("viewer"),
      application: {
        async list(input: unknown) { calls.push(input); return { data: [], nextCursor: null }; },
        async status(input: unknown) { calls.push(input); return status(); },
      } as never,
    });
    expect((await handler(new Request(`http://localhost/api/v1/content/interactions?cursor=fixture&limit=12&type=comment&postId=${postId}&direction=incoming&status=observed`))).status).toBe(200);
    expect((await handler(new Request("http://localhost/api/v1/content/interactions/status"))).status).toBe(200);
    expect(calls).toEqual([
      { workspaceId, cursor: "fixture", limit: 12, type: "comment", socialContentId: postId, direction: "incoming", status: "observed" },
      { workspaceId },
    ]);
  });

  test("rejects invalid filters and mutations", async () => {
    const handler = createSocialEngagementHttpHandler({ contextResolver: context("viewer"), application: {} as never });
    expect((await handler(new Request("http://localhost/api/v1/content/interactions?type=like"))).status).toBe(422);
    expect((await handler(new Request("http://localhost/api/v1/content/interactions", { method: "POST" }))).status).toBe(405);
  });

  test("requires workspace viewer access", async () => {
    const handler = createSocialEngagementHttpHandler({ contextResolver: context("guest"), application: {} as never });
    expect((await handler(new Request("http://localhost/api/v1/content/interactions/status"))).status).toBe(403);
  });
});

function context(role: WorkspaceRole | "guest"): RequestContextResolver { return { async resolve() { return { workspaceId, userId, role: role as WorkspaceRole }; } }; }
function status() { return { status: "idle", observed: 1, incoming: 1, lastSuccessAt: new Date("2026-08-21T06:00:00.000Z"), nextSyncAt: new Date("2026-08-21T06:15:00.000Z"), lastErrorCode: null, lastErrorMessage: null }; }
