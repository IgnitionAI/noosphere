"use server";

import { revalidatePath } from "next/cache";
import { reviewIcpProposal } from "@/lib/api";

export async function approveProposal(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
  _formData: FormData,
) {
  await reviewIcpProposal(workspaceSlug, runId, "approve-icp", proposalId, null);
  revalidatePath(`/w/${workspaceSlug}/research/${runId}/report`);
}

export async function rejectProposal(
  workspaceSlug: string,
  runId: string,
  proposalId: string,
  formData: FormData,
) {
  await reviewIcpProposal(
    workspaceSlug,
    runId,
    "reject-icp",
    proposalId,
    String(formData.get("reason") ?? "ICP rejeté lors de la revue humaine."),
  );
  revalidatePath(`/w/${workspaceSlug}/research/${runId}/report`);
}
