"use server";

import { productResearchBriefSchema } from "@outbound/contracts/product-research";
import { redirect } from "next/navigation";
import {
  createResearchRun,
  OutboundApiError,
  researchAction,
} from "@/lib/api";

export interface CreateMissionState {
  readonly error: string | null;
}

export async function createResearchMission(
  workspaceSlug: string,
  _previous: CreateMissionState,
  formData: FormData,
): Promise<CreateMissionState> {
  const parsed = productResearchBriefSchema.safeParse({
    productUrl: String(formData.get("productUrl") ?? "").trim(),
    productName: String(formData.get("productName") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    geography: String(formData.get("geography") ?? "").trim(),
    languages: String(formData.get("languages") ?? "")
      .split(",")
      .map((language) => language.trim())
      .filter(Boolean),
    salesMotion: formData.get("salesMotion"),
    knownCompetitors: formData
      .getAll("knownCompetitors")
      .map((competitor) => String(competitor).trim())
      .filter(Boolean),
    internalDocumentIds: [],
    depth: formData.get("depth"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Le brief contient une valeur invalide.",
    };
  }

  let runId: string;
  try {
    const run = await createResearchRun(workspaceSlug, parsed.data);
    runId = run.id;
    await researchAction(workspaceSlug, run.id, "start");
  } catch (error) {
    return {
      error:
        error instanceof OutboundApiError
          ? error.message
          : "La mission n’a pas pu être lancée. Réessayez dans quelques instants.",
    };
  }
  redirect(`/w/${workspaceSlug}/research/${runId}`);
}
