import type { WorkspaceMember, WorkspaceRole } from "./api";

export const workspaceRoleLabels: Readonly<Record<WorkspaceRole, string>> = {
  owner: "Owner",
  admin: "Administrateur",
  operator: "Opérateur",
  reviewer: "Reviewer",
  viewer: "Lecteur",
};

export function manageableWorkspaceRoles(actorRole: WorkspaceRole): readonly WorkspaceRole[] {
  return actorRole === "owner"
    ? ["owner", "admin", "operator", "reviewer", "viewer"]
    : ["admin", "operator", "reviewer", "viewer"];
}

export function canManageWorkspaceMember(input: {
  actorUserId: string;
  actorRole: WorkspaceRole;
  member: Pick<WorkspaceMember, "userId" | "role">;
}): boolean {
  if (input.actorUserId === input.member.userId) return false;
  if (input.actorRole === "owner") return true;
  return input.actorRole === "admin" && input.member.role !== "owner";
}

export function workspaceMemberLabel(member: Pick<WorkspaceMember, "name" | "email">): string {
  return member.name.trim() || member.email;
}
