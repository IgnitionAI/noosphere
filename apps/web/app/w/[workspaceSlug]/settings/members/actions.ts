"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeWorkspaceMemberRole,
  inviteWorkspaceMember,
  OutboundApiError,
  revokeWorkspaceInvitation,
  setWorkspaceMemberStatus,
  type WorkspaceMemberStatus,
  type WorkspaceRole,
} from "@/lib/api";

const page = (workspaceSlug: string) => `/w/${workspaceSlug}/settings/members`;

export async function inviteMemberAction(
  workspaceSlug: string,
  workspaceId: string,
  formData: FormData,
): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "viewer") as WorkspaceRole;
  await run(workspaceSlug, "Invitation créée. Le lien est prêt à être partagé.", () =>
    inviteWorkspaceMember(workspaceSlug, workspaceId, { email, role }),
  );
}

export async function revokeInvitationAction(
  workspaceSlug: string,
  invitationId: string,
): Promise<void> {
  await run(workspaceSlug, "Invitation révoquée.", () =>
    revokeWorkspaceInvitation(workspaceSlug, invitationId),
  );
}

export async function changeMemberRoleAction(
  workspaceSlug: string,
  workspaceId: string,
  userId: string,
  formData: FormData,
): Promise<void> {
  const role = String(formData.get("role") ?? "viewer") as WorkspaceRole;
  await run(workspaceSlug, "Rôle mis à jour.", () =>
    changeWorkspaceMemberRole(workspaceSlug, workspaceId, userId, role),
  );
}

export async function setMemberStatusAction(
  workspaceSlug: string,
  workspaceId: string,
  userId: string,
  status: WorkspaceMemberStatus,
): Promise<void> {
  await run(workspaceSlug, status === "active" ? "Accès réactivé." : "Accès désactivé.", () =>
    setWorkspaceMemberStatus(workspaceSlug, workspaceId, userId, status),
  );
}

async function run(workspaceSlug: string, notice: string, mutation: () => Promise<unknown>) {
  let errorCode: string | null = null;
  try {
    await mutation();
    revalidatePath(page(workspaceSlug));
  } catch (error) {
    errorCode = error instanceof OutboundApiError ? error.code : "UPSTREAM_ERROR";
  }
  const query = errorCode
    ? `error=${encodeURIComponent(errorCode)}`
    : `notice=${encodeURIComponent(notice)}`;
  redirect(`${page(workspaceSlug)}?${query}`);
}
