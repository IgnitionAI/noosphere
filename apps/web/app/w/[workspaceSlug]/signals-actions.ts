"use server";

import { revalidatePath } from "next/cache";
import { collectSignals, OutboundApiError } from "@/lib/api";

export async function collectSignalsAction(workspaceSlug: string, formData: FormData) {
  const entityType = String(formData.get("entityType") ?? "").trim();
  const entityId = String(formData.get("entityId") ?? "").trim();
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if ((entityType !== "company" && entityType !== "contact") || !entityId || !requestKey) throw new Error("La cible et la clé de collecte sont obligatoires.");
  try {
    const run = entityType === "company"
      ? await collectSignals(workspaceSlug, { companyId: entityId, requestKey })
      : await collectSignals(workspaceSlug, { contactId: entityId, requestKey });
    revalidatePath(`/w/${workspaceSlug}/${entityType === "company" ? "companies" : "prospects"}/${entityId}`);
    return run;
  } catch (error) {
    throw new Error(error instanceof OutboundApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "La collecte des signaux a échoué.");
  }
}
