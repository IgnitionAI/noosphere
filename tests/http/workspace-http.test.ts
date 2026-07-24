import { describe, expect, test } from "bun:test";
import { createWorkspaceHttpHandler } from "@outbound/interface/http/workspace-handler";
import type {
  AuthenticatedSessionReader,
  WorkspaceMembershipDirectory,
} from "@outbound/interface/http/authenticated-workspace-context";

describe("workspace HTTP routes", () => {
  test("lists only the active workspaces available to the authenticated user", async () => {
    const handle = createWorkspaceHttpHandler({
      sessions: authenticatedSession(),
      memberships: {
        async listActiveMemberships() {
          return [
            {
              workspaceId: "00000000-0000-4000-8000-000000000002",
              slug: "ignition-ai",
              name: "IgnitionAI",
              role: "owner",
              lastSelectedAt: new Date("2026-07-24T18:00:00.000Z"),
            },
          ];
        },
      },
    });

    const response = await handle(new Request("http://localhost/api/v1/workspaces"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          slug: "ignition-ai",
          name: "IgnitionAI",
          role: "owner",
          lastSelectedAt: "2026-07-24T18:00:00.000Z",
        },
      ],
    });
  });

  test("rejects a missing or revoked session", async () => {
    const handle = createWorkspaceHttpHandler({
      sessions: { async getSession() { return null; } },
      memberships: emptyDirectory(),
    });

    const response = await handle(new Request("http://localhost/api/v1/workspaces"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });
});

function authenticatedSession(): AuthenticatedSessionReader {
  return {
    async getSession() {
      return { userId: "00000000-0000-4000-8000-000000000001" };
    },
  };
}

function emptyDirectory(): WorkspaceMembershipDirectory {
  return { async listActiveMemberships() { return []; } };
}
