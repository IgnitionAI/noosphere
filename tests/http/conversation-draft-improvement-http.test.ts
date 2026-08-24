import { describe, expect, test } from "bun:test";
import { ConversationDraftNotFoundError } from "@outbound/application/campaigns/conversation-draft-improver";
import { createCampaignHttpHandler } from "@outbound/interface/http/campaign-handler";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

describe("conversation draft improvement HTTP route", () => {
  test("returns an editable improvement without creating a send command", async () => {
    const handler = createCampaignHttpHandler({
      contextResolver: context("operator"),
      database: {} as never,
      jobQueue: {} as never,
      draftImprover: {
        async improve(input) {
          expect(input).toEqual({
            workspaceId,
            conversationId,
            draft: "salut on peut parler demain ?",
          });
          return {
            body: "Salut, serait-il possible d’échanger demain ?",
            metadata: { provider: "kimi-code", model: "k3-256k", promptVersion: "test" },
          };
        },
      },
    });
    const response = await handler(new Request(
      `http://localhost/api/v1/conversations/${conversationId}/draft-improvements`,
      { method: "POST", body: JSON.stringify({ draft: "salut on peut parler demain ?" }) },
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      body: "Salut, serait-il possible d’échanger demain ?",
    });
  });

  test("rejects viewers and empty drafts", async () => {
    const draftImprover = { async improve() { throw new Error("unexpected"); } };
    const viewer = createCampaignHttpHandler({
      contextResolver: context("viewer"),
      database: {} as never,
      jobQueue: {} as never,
      draftImprover,
    });
    expect((await viewer(new Request(
      `http://localhost/api/v1/conversations/${conversationId}/draft-improvements`,
      { method: "POST", body: JSON.stringify({ draft: "Bonjour" }) },
    ))).status).toBe(403);

    const operator = createCampaignHttpHandler({
      contextResolver: context("operator"),
      database: {} as never,
      jobQueue: {} as never,
      draftImprover,
    });
    expect((await operator(new Request(
      `http://localhost/api/v1/conversations/${conversationId}/draft-improvements`,
      { method: "POST", body: JSON.stringify({ draft: "   " }) },
    ))).status).toBe(400);
  });

  test("does not reveal a conversation from another workspace", async () => {
    const handler = createCampaignHttpHandler({
      contextResolver: context("operator"),
      database: {} as never,
      jobQueue: {} as never,
      draftImprover: {
        async improve() {
          throw new ConversationDraftNotFoundError();
        },
      },
    });
    const response = await handler(new Request(
      `http://localhost/api/v1/conversations/${conversationId}/draft-improvements`,
      { method: "POST", body: JSON.stringify({ draft: "Bonjour" }) },
    ));
    expect(response.status).toBe(404);
  });
});

function context(role: "viewer" | "operator") {
  return {
    async resolve() {
      return { userId: crypto.randomUUID(), workspaceId, role };
    },
  };
}
