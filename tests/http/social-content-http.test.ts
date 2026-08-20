import { describe, expect, test } from "bun:test";
import { createSocialContentHttpHandler } from "@outbound/interface/http/social-content-handler";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const workspaceId = "34000000-0000-4000-8000-000000000001";
const userId = "34000000-0000-4000-8000-000000000002";

describe("LNK-102 social content HTTP", () => {
  test("derives the workspace from the session and preserves cursor pagination", async () => {
    const calls: unknown[] = [];
    const handler = createSocialContentHttpHandler({
      contextResolver: context("viewer"),
      application: {
        async list(input: unknown) { calls.push(input); return { data: [], nextCursor: null }; },
        async status(input: unknown) { calls.push(input); return status(); },
      } as never,
    });
    expect((await handler(new Request("http://localhost/api/v1/content/social-posts?cursor=fixture&limit=12"))).status).toBe(200);
    expect((await handler(new Request("http://localhost/api/v1/content/social-posts/status"))).status).toBe(200);
    expect(calls).toEqual([
      { workspaceId, cursor: "fixture", limit: 12 },
      { workspaceId },
    ]);
  });

  test("rejects invalid limits and mutations", async () => {
    const handler = createSocialContentHttpHandler({ contextResolver: context("viewer"), application: {} as never });
    expect((await handler(new Request("http://localhost/api/v1/content/social-posts?limit=101"))).status).toBe(422);
    expect((await handler(new Request("http://localhost/api/v1/content/social-posts", { method: "POST" }))).status).toBe(405);
  });

  test("requires workspace viewer access", async () => {
    const handler = createSocialContentHttpHandler({ contextResolver: context("guest"), application: {} as never });
    expect((await handler(new Request("http://localhost/api/v1/content/social-posts/status"))).status).toBe(403);
  });
});

function context(role: WorkspaceRole | "guest"): RequestContextResolver { return { async resolve() { return { workspaceId, userId, role: role as WorkspaceRole }; } }; }
function status() { return { status: "idle", backfillComplete: true, lastSuccessAt: new Date("2026-08-21T06:00:00.000Z"), nextSyncAt: new Date("2026-08-21T06:15:00.000Z"), lastErrorCode: null, lastErrorMessage: null }; }
