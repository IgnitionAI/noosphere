"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { researchAction, OutboundApiError } from "@/lib/api";

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
  await runResearchAction(workspaceSlug, runId, "resume");
  revalidatePath(`/w/${workspaceSlug}/research/${runId}`);
}

export async function resumeResearchWithCurrentModels(
  workspaceSlug: string,
  runId: string,
  _formData: FormData,
) {
  await runResearchAction(workspaceSlug, runId, "resume-current-models");
  revalidatePath(`/w/${workspaceSlug}/research/${runId}`);
}

export async function startResearch(
  workspaceSlug: string,
  runId: string,
  _formData: FormData,
) {
  await runResearchAction(workspaceSlug, runId, "start");
  revalidatePath(`/w/${workspaceSlug}/research/${runId}`);
}

async function runResearchAction(workspaceSlug: string, runId: string, action: "start" | "resume" | "resume-current-models") {
  try {
    await researchAction(workspaceSlug, runId, action);
  } catch (error) {
    if (error instanceof OutboundApiError && error.code === "RESEARCH_MODEL_CHANGE_BUSY") {
      redirect(`/w/${encodeURIComponent(workspaceSlug)}/research/${encodeURIComponent(runId)}?error=RESEARCH_MODEL_CHANGE_BUSY`);
    }
    if (error instanceof OutboundApiError && error.code === "PRODUCT_RESEARCH_ALREADY_ACTIVE") {
      redirect(`/w/${encodeURIComponent(workspaceSlug)}/research/${encodeURIComponent(runId)}?error=PRODUCT_RESEARCH_ALREADY_ACTIVE`);
    }
    if (error instanceof OutboundApiError && error.code === "AI_SETUP_REQUIRED") {
      redirect(`/w/${encodeURIComponent(workspaceSlug)}/research/${encodeURIComponent(runId)}?error=AI_SETUP_REQUIRED`);
    }
    throw error;
  }
}
