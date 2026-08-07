"use server";

import { revalidatePath } from "next/cache";
import { approveMergeCandidate, rejectMergeCandidate } from "@/lib/api";

export async function approveMergeCandidateAction(workspaceSlug: string, candidateId: string, _formData: FormData) {
  await approveMergeCandidate(workspaceSlug, candidateId);
  revalidatePath(`/w/${workspaceSlug}/duplicates`);
  revalidatePath(`/w/${workspaceSlug}/duplicates/${candidateId}`);
}

export async function rejectMergeCandidateAction(workspaceSlug: string, candidateId: string, formData: FormData) {
  const reason = String(formData.get("reason") ?? "").trim();
  await rejectMergeCandidate(workspaceSlug, candidateId, reason || null);
  revalidatePath(`/w/${workspaceSlug}/duplicates`);
  revalidatePath(`/w/${workspaceSlug}/duplicates/${candidateId}`);
}
