import { describe, expect, test } from "bun:test";
import {
  canManageWorkspaceMember,
  manageableWorkspaceRoles,
  workspaceMemberLabel,
} from "../../apps/web/lib/workspace-members";

describe("workspace member UI policy", () => {
  test("prevents self mutation and prevents admins from managing owners", () => {
    expect(canManageWorkspaceMember({ actorUserId: "u1", actorRole: "owner", member: { userId: "u1", role: "owner" } })).toBe(false);
    expect(canManageWorkspaceMember({ actorUserId: "u1", actorRole: "admin", member: { userId: "u2", role: "owner" } })).toBe(false);
    expect(canManageWorkspaceMember({ actorUserId: "u1", actorRole: "admin", member: { userId: "u2", role: "operator" } })).toBe(true);
  });

  test("only owners can assign the owner role", () => {
    expect(manageableWorkspaceRoles("owner")).toContain("owner");
    expect(manageableWorkspaceRoles("admin")).not.toContain("owner");
  });

  test("uses email when a member has no readable name", () => {
    expect(workspaceMemberLabel({ name: "  ", email: "member@example.com" })).toBe("member@example.com");
  });
});
