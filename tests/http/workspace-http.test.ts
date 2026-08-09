import { describe, expect, test } from "bun:test";
import {
  createWorkspaceHttpHandler,
  type WorkspaceManagementService,
} from "@outbound/interface/http/workspace-handler";
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

  test("revokes an invitation inside the authenticated workspace", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000002";
    const invitationId = "00000000-0000-4000-8000-000000000003";
    const calls: unknown[] = [];
    const handle = createWorkspaceHttpHandler({
      sessions: authenticatedSession(),
      memberships: emptyDirectory(),
      contextResolver: {
        async resolve() {
          return {
            userId: "00000000-0000-4000-8000-000000000001",
            workspaceId,
            role: "owner" as const,
          };
        },
      },
      management: managementStub({
        async revokeInvitation(input: Parameters<WorkspaceManagementService["revokeInvitation"]>[0]) {
          calls.push(input);
          return { id: invitationId, status: "revoked" };
        },
      }),
    });

    const response = await handle(new Request(
      `http://localhost/api/v1/invitations/${invitationId}/actions/revoke`,
      { method: "POST", headers: { "x-workspace-slug": "ignition-ai" } },
    ));

    expect(response.status).toBe(200);
    expect(calls).toEqual([{
      workspaceId,
      invitationId,
      actorUserId: "00000000-0000-4000-8000-000000000001",
    }]);
  });

  test("does not claim an invitation email was sent when no mailer is configured", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000002";
    const handle = createWorkspaceHttpHandler({
      sessions: authenticatedSession(),
      memberships: emptyDirectory(),
      contextResolver: {
        async resolve() {
          return {
            userId: "00000000-0000-4000-8000-000000000001",
            workspaceId,
            role: "owner" as const,
          };
        },
      },
      management: managementStub({
        async invite() {
          return {
            id: "00000000-0000-4000-8000-000000000003",
            workspaceId,
            email: "member@example.com",
            proposedRole: "operator",
            expiresAt: new Date("2026-08-16T06:00:00.000Z"),
          };
        },
      }),
    });

    const response = await handle(new Request(`http://localhost/api/v1/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-workspace-slug": "ignition-ai" },
      body: JSON.stringify({ email: "member@example.com", role: "operator" }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ emailDelivery: "not_configured" });
  });
});

function managementStub(overrides: Partial<WorkspaceManagementService> = {}): WorkspaceManagementService {
  return {
    async createWorkspace() { return {}; },
    async listMembers() { return []; },
    async listInvitations() { return []; },
    async invite() { throw new Error("not implemented"); },
    async acceptInvitation() { return {}; },
    async revokeInvitation() { return {}; },
    async changeRole() { return {}; },
    async setStatus() { return {}; },
    ...overrides,
  };
}

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
