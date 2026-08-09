"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  completeWorkspaceOnboardingStep,
  OutboundApiError,
  skipWorkspaceOnboardingStep,
  type WorkspaceOnboardingStep,
} from "@/lib/api";

export async function completeOnboardingStepAction(workspaceSlug: string, workspaceId: string, formData: FormData): Promise<void> {
  await mutate(workspaceSlug, workspaceId, String(formData.get("step") ?? "") as WorkspaceOnboardingStep, "complete");
}

export async function skipOnboardingStepAction(workspaceSlug: string, workspaceId: string, formData: FormData): Promise<void> {
  await mutate(workspaceSlug, workspaceId, String(formData.get("step") ?? "") as WorkspaceOnboardingStep, "skip");
}

async function mutate(workspaceSlug: string, workspaceId: string, step: WorkspaceOnboardingStep, action: "complete" | "skip") {
  let error: string | null = null;
  try {
    if (action === "complete") await completeWorkspaceOnboardingStep(workspaceSlug, workspaceId, step);
    else await skipWorkspaceOnboardingStep(workspaceSlug, workspaceId, step);
    revalidatePath("/onboarding");
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  } catch (cause) {
    error = cause instanceof OutboundApiError ? cause.code : "UPSTREAM_ERROR";
  }
  redirect(`/onboarding?workspace=${encodeURIComponent(workspaceSlug)}${error ? `&error=${encodeURIComponent(error)}` : ""}#${step}`);
}
