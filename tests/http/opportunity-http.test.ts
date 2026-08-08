import { describe, expect, test } from "bun:test";
import { createOpportunityHttpHandler } from "@outbound/interface/http/opportunity-handler";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const opportunityId = "22222222-2222-4222-8222-222222222222";

describe("opportunity HTTP routes", () => {
  test("a viewer reads the workspace pipeline", async () => {
    const handler = createOpportunityHttpHandler({
      contextResolver: context("viewer"),
      repository: {
        async list(receivedWorkspaceId) {
          expect(receivedWorkspaceId).toBe(workspaceId);
          return { data: [{ id: opportunityId }], metrics: { total: 1 } } as never;
        },
        async changeStage() { throw new Error("unexpected"); },
      },
    });
    const response = await handler(new Request("http://localhost/api/v1/opportunities"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ metrics: { total: 1 } });
  });

  test("an operator changes a stage through an explicit action", async () => {
    const handler = createOpportunityHttpHandler({
      contextResolver: context("operator"),
      repository: {
        async list() { throw new Error("unexpected"); },
        async changeStage(input) {
          expect(input).toMatchObject({ workspaceId, opportunityId, stage: "won", reason: "Contrat signé" });
          return { id: opportunityId, stage: "won" } as never;
        },
      },
    });
    const response = await handler(new Request(
      `http://localhost/api/v1/opportunities/${opportunityId}/actions/change-stage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: "won", reason: "Contrat signé" }),
      },
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stage: "won" });
  });

  test("a viewer cannot mutate and invalid stages fail closed", async () => {
    const repository = {
      async list() { return { data: [], metrics: {} } as never; },
      async changeStage() { throw new Error("unexpected"); },
    };
    const viewerHandler = createOpportunityHttpHandler({ contextResolver: context("viewer"), repository });
    const forbidden = await viewerHandler(new Request(
      `http://localhost/api/v1/opportunities/${opportunityId}/actions/change-stage`,
      { method: "POST", body: JSON.stringify({ stage: "won" }) },
    ));
    expect(forbidden.status).toBe(403);

    const operatorHandler = createOpportunityHttpHandler({ contextResolver: context("operator"), repository });
    const invalid = await operatorHandler(new Request(
      `http://localhost/api/v1/opportunities/${opportunityId}/actions/change-stage`,
      { method: "POST", body: JSON.stringify({ stage: "invented" }) },
    ));
    expect(invalid.status).toBe(400);
  });
});

function context(role: "viewer" | "operator") {
  return {
    async resolve() {
      return { userId: crypto.randomUUID(), workspaceId, role };
    },
  };
}
