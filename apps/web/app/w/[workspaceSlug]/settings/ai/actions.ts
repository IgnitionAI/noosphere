"use server";

import { revalidatePath } from "next/cache";
import {
  updateWorkspaceAiSettings,
  type AiCapability,
  type AiModelRoute,
} from "@/lib/api";

export async function saveWorkspaceAiSettings(
  workspaceSlug: string,
  _previous: { message: string; error: boolean },
  formData: FormData,
): Promise<{ message: string; error: boolean }> {
  try {
    await updateWorkspaceAiSettings(workspaceSlug, parseRouting(formData.get("modelRouting")));
  } catch {
    return { message: "Enregistrement impossible. Vérifiez vos droits et que les modèles sélectionnés sont toujours autorisés, puis réessayez.", error: true };
  }
  revalidatePath(`/w/${workspaceSlug}/settings/ai`);
  return { message: "Modèles du workspace enregistrés.", error: false };
}

function parseRouting(value: FormDataEntryValue | null): {
  defaultRoutes: readonly AiModelRoute[];
  capabilityRoutes: Readonly<Partial<Record<AiCapability, readonly AiModelRoute[]>>>;
} {
  if (typeof value !== "string") throw new Error("AI_MODEL_ROUTING_REQUIRED");
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.defaultRoutes) || !isRecord(parsed.capabilityRoutes)) {
    throw new Error("AI_MODEL_ROUTING_INVALID");
  }
  return {
    defaultRoutes: parsed.defaultRoutes as readonly AiModelRoute[],
    capabilityRoutes: parsed.capabilityRoutes as Partial<Record<AiCapability, readonly AiModelRoute[]>>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
