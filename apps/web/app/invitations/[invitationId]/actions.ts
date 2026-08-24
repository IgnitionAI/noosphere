"use server";

import { redirect } from "next/navigation";
import { acceptWorkspaceInvitation, listWorkspaces, OutboundApiError } from "@/lib/api";

export async function acceptInvitationAction(invitationId: string): Promise<void> {
  let workspaceId: string | null = null;
  let errorCode: string | null = null;
  try {
    const result = await acceptWorkspaceInvitation(invitationId);
    workspaceId = result.invitation.workspaceId;
  } catch (error) {
    errorCode = error instanceof OutboundApiError ? error.code : "UPSTREAM_ERROR";
  }
  if (workspaceId) {
    const workspace = (await listWorkspaces()).find((candidate) => candidate.id === workspaceId);
    if (workspace) redirect(`/w/${workspace.slug}/strategy/product-reading`);
  }
  redirect(`/invitations/${invitationId}?error=${encodeURIComponent(errorCode ?? "WORKSPACE_INVITATION_NOT_FOUND")}`);
}
