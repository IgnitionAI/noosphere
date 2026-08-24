import { describe, expect, test } from "bun:test";
import { createAttributionHttpHandler } from "@outbound/interface/http/attribution-handler";
import type { RequestContextResolver, WorkspaceRole } from "@outbound/interface/http/request-context";

const workspaceId = "36000000-0000-4000-8000-000000000001";
const userId = "36000000-0000-4000-8000-000000000002";
const interactionId = "36000000-0000-4000-8000-000000000003";
const bookingId = "36000000-0000-4000-8000-000000000004";

describe("ATT-101 attribution HTTP", () => {
  test("derives workspace from the session and preserves attribution filters", async () => {
    const calls: unknown[] = [];
    const handler = createAttributionHttpHandler({
      contextResolver: context("viewer"),
      application: { async listJourneys(input: unknown) { calls.push(input); return { data: [], nextCursor: null }; } } as never,
    });
    const response = await handler(new Request(`http://localhost/api/v1/attribution/journeys?cursor=fixture&limit=12&interactionId=${interactionId}&bookingId=${bookingId}`));
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ workspaceId, cursor: "fixture", limit: 12, interactionId, bookingId }]);
  });

  test("rejects invalid identifiers and every mutation", async () => {
    const handler = createAttributionHttpHandler({ contextResolver: context("viewer"), application: {} as never });
    expect((await handler(new Request("http://localhost/api/v1/attribution/journeys?bookingId=nope"))).status).toBe(422);
    expect((await handler(new Request("http://localhost/api/v1/attribution/journeys", { method: "POST" }))).status).toBe(405);
  });

  test("requires workspace viewer access", async () => {
    const handler = createAttributionHttpHandler({ contextResolver: context("guest"), application: {} as never });
    expect((await handler(new Request("http://localhost/api/v1/attribution/journeys"))).status).toBe(403);
  });
});

function context(role: WorkspaceRole | "guest"): RequestContextResolver { return { async resolve() { return { workspaceId, userId, role: role as WorkspaceRole }; } }; }
