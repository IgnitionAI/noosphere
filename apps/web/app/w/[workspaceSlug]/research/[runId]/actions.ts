"use server";

import { revalidatePath } from "next/cache";
import { researchAction } from "@/lib/api";

export async function pauseResearch(
  workspaceSlug: string,
  runId: string,
  _formData: FormData,
) {
  await researchAction(workspaceSlug, runId, "pause");
  revalidatePath(`/w/${workspaceSlug}/research/${runId}`);
}

export async function resumeResearch(
  workspaceSlug: string,
  runId: string,
  _formData: FormData,
) {
  await researchAction(workspaceSlug, runId, "resume");
  revalidatePath(`/w/${workspaceSlug}/research/${runId}`);
}

export async function startResearch(
  workspaceSlug: string,
  runId: string,
  _formData: FormData,
) {
  await researchAction(workspaceSlug, runId, "start");
  revalidatePath(`/w/${workspaceSlug}/research/${runId}`);
}
