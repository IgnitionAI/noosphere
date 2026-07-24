import { describe, expect, test } from "bun:test";
import {
  AuthenticatedWorkspaceContextResolver,
  type AuthenticatedSessionReader,
  type WorkspaceMembershipReader,
} from "@outbound/interface/http/authenticated-workspace-context";
import {
  RequestAuthenticationError,
  WorkspaceAccessDeniedError,
  WorkspaceContextRequiredError,
} from "@outbound/interface/http/request-context";

const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";

describe("AuthenticatedWorkspaceContextResolver", () => {
  test("resolves an authenticated member from the workspace selected by route context", async () => {
    const resolver = createResolver();

    const context = await resolver.resolve(
      new Request("http://localhost/api/v1/product-research-runs", {
        headers: { "x-workspace-slug": "ignition-ai" },
      }),
    );

    expect(context).toEqual({ userId, workspaceId, role: "operator" });
  });

  test("rejects an absent or revoked session", async () => {
    const resolver = createResolver({ session: null });

    await expect(
      resolver.resolve(
        new Request("http://localhost/api/v1/product-research-runs", {
          headers: { "x-workspace-slug": "ignition-ai" },
        }),
      ),
    ).rejects.toBeInstanceOf(RequestAuthenticationError);
  });

  test("requires an explicit workspace route context", async () => {
    const resolver = createResolver();

    await expect(
      resolver.resolve(new Request("http://localhost/api/v1/product-research-runs")),
    ).rejects.toBeInstanceOf(WorkspaceContextRequiredError);
  });

  test("does not expose whether an inaccessible workspace exists", async () => {
    const resolver = createResolver({ membership: null });

    await expect(
      resolver.resolve(
        new Request("http://localhost/api/v1/product-research-runs", {
          headers: { "x-workspace-slug": "another-workspace" },
        }),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});

function createResolver(overrides: {
  session?: { userId: string } | null;
  membership?: { workspaceId: string; role: "operator" } | null;
} = {}) {
  const sessionReader: AuthenticatedSessionReader = {
    async getSession() {
      return overrides.session === undefined ? { userId } : overrides.session;
    },
  };
  const memberships: WorkspaceMembershipReader = {
    async findActiveMembership() {
      return overrides.membership === undefined
        ? { workspaceId, role: "operator" }
        : overrides.membership;
    },
  };
  return new AuthenticatedWorkspaceContextResolver(sessionReader, memberships);
}
