import { describe, expect, test } from "bun:test";
import { createCampaignHttpHandler } from "@outbound/interface/http/campaign-handler";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

describe("conversation command HTTP route", () => {
  test("accepts an idempotent effect-free Setter dry-run", async () => {
    const handler = createCampaignHttpHandler({
      contextResolver: context("operator"),
      database: {} as never,
      conversationCommands: {
        async create(input) {
          expect(input).toMatchObject({
            workspaceId,
            conversationId,
            requestedBy: userId,
            mode: "setter",
            executionMode: "dry_run",
            body: null,
            idempotencyKey: "setter-dry-run-request",
          });
          return {
            id: "44444444-4444-4444-8444-444444444444",
            workspaceId,
            conversationId,
            requestedBy: userId,
            mode: "setter",
            executionMode: "dry_run",
            requestedBody: null,
            generatedBody: null,
            generationMetadata: {},
            status: "scheduled",
            idempotencyKey: "setter-dry-run-request",
            providerRequestId: null,
            errorCode: null,
            errorMessage: null,
            sentAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
        async setAutomationMode() { throw new Error("unexpected"); },
      },
    });
    const response = await handler(request("operator", {
      mode: "setter",
      executionMode: "dry_run",
      idempotencyKey: "setter-dry-run-request",
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ executionMode: "dry_run", status: "scheduled" });
  });

  test("rejects manual dry-run and viewer access before persistence", async () => {
    const conversationCommands = {
      async create() { throw new Error("unexpected"); },
      async setAutomationMode() { throw new Error("unexpected"); },
    };
    const operator = createCampaignHttpHandler({
      contextResolver: context("operator"),
      database: {} as never,
      conversationCommands,
    });
    expect((await operator(request("operator", {
      mode: "manual",
      executionMode: "dry_run",
      body: "Bonjour",
      idempotencyKey: "manual-dry-run-request",
    }))).status).toBe(400);

    const viewer = createCampaignHttpHandler({
      contextResolver: context("viewer"),
      database: {} as never,
      conversationCommands,
    });
    expect((await viewer(request("viewer", {
      mode: "setter",
      executionMode: "dry_run",
      idempotencyKey: "viewer-dry-run-request",
    }))).status).toBe(403);
  });
});

function context(role: "viewer" | "operator") {
  return { async resolve() { return { userId, workspaceId, role }; } };
}

function request(_role: "viewer" | "operator", body: unknown) {
  return new Request(`http://localhost/api/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
