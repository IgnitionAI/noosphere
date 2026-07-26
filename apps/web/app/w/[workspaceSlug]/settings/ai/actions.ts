"use server";

import { revalidatePath } from "next/cache";
import { updateWorkspaceAiSettings } from "@/lib/api";

export async function saveWorkspaceAiSettings(
  workspaceSlug: string,
  formData: FormData,
): Promise<void> {
  await updateWorkspaceAiSettings(workspaceSlug, {
    researchModels: readOrderedModels(formData, "researchModel"),
    synthesisModels: readOrderedModels(formData, "synthesisModel"),
  });
  revalidatePath(`/w/${workspaceSlug}/settings/ai`);
}

function readOrderedModels(formData: FormData, name: string): string[] {
  const models = formData
    .getAll(name)
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(models)];
}
