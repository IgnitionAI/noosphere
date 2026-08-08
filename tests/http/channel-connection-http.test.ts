import { describe, expect, test } from "bun:test";
import { createChannelConnectionHttpHandler } from "@outbound/interface/http/channel-connection-handler";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const accountId = "unipile-whatsapp-account";

describe("WhatsApp channel connection HTTP route", () => {
  test("lists only safe selectable account metadata", async () => {
    const handler = createChannelConnectionHttpHandler({
      contextResolver: context("owner"),
      connections: fixtureConnections(),
    });
    const response = await handler(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      channel: "whatsapp",
      connected: true,
      selectedAccountId: null,
      selectedDisplayName: null,
      accounts: [{
        id: accountId,
        name: "+33749628470",
        channel: "whatsapp",
        healthy: true,
        selected: false,
      }],
    });
  });

  test("lets an owner select a healthy WhatsApp account for the workspace", async () => {
    let selectedForWorkspace = "";
    let reassessed = false;
    const connections = fixtureConnections({
      async select(input: {
        workspaceId: string;
        selectedBy: string;
        providerAccountId: string;
        channel: "whatsapp";
      }) {
        expect(input).toMatchObject({ workspaceId, selectedBy: userId, providerAccountId: accountId, channel: "whatsapp" });
        selectedForWorkspace = input.providerAccountId;
        return { id: accountId, name: "+33749628470", channel: "whatsapp" as const, healthy: true, selected: true };
      },
    });
    const handler = createChannelConnectionHttpHandler({
      contextResolver: context("owner"),
      connections,
      reassessment: {
        async schedule(input) {
          expect(input).toMatchObject({ workspaceId, channel: "whatsapp", capabilityKey: accountId });
          reassessed = true;
          return 1;
        },
      },
    });
    const response = await handler(request("PUT", { providerAccountId: accountId }));
    expect(response.status).toBe(200);
    expect(selectedForWorkspace).toBe(accountId);
    expect(reassessed).toBe(true);
  });

  test("rejects non-admin selection and a missing server connector", async () => {
    const operator = createChannelConnectionHttpHandler({
      contextResolver: context("operator"),
      connections: fixtureConnections(),
    });
    expect((await operator(request("PUT", { providerAccountId: accountId }))).status).toBe(403);

    const unavailable = createChannelConnectionHttpHandler({
      contextResolver: context("owner"),
      connections: null,
    });
    const response = await unavailable(request("GET"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNIPILE_NOT_CONFIGURED" });
  });
});

function fixtureConnections(overrides: Record<string, unknown> = {}) {
  return {
    async list() {
      return [{ id: accountId, name: "+33749628470", channel: "whatsapp" as const, healthy: true, selected: false }];
    },
    async selectedAccount() { return null; },
    async select() {
      return { id: accountId, name: "+33749628470", channel: "whatsapp" as const, healthy: true, selected: true };
    },
    ...overrides,
  } as never;
}

function context(role: "owner" | "operator") {
  return { async resolve() { return { workspaceId, userId, role }; } };
}

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/v1/channel-connections/whatsapp", {
    method,
    headers: { "content-type": "application/json", "x-workspace-slug": "ignition-ai" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
