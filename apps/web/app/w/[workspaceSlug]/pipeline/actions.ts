"use server";

import { revalidatePath } from "next/cache";
import {
  closeOpportunity,
  OutboundApiError,
  reopenOpportunity,
  updateOpportunity,
} from "@/lib/api";

const page = (workspaceSlug: string) => `/w/${workspaceSlug}/pipeline`;
const value = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const optionalNumber = (formData: FormData, key: string) => {
  const raw = value(formData, key);
  return raw === "" ? null : Number(raw);
};

export async function updateOpportunityAction(workspaceSlug: string, opportunityId: string, formData: FormData) {
  const amountRaw = value(formData, "amount");
  const expectedCloseDate = value(formData, "expectedCloseDate");
  try {
    await updateOpportunity(workspaceSlug, opportunityId, {
      amount: amountRaw === "" ? null : Number(amountRaw),
      currency: value(formData, "currency") || null,
      probability: Number(value(formData, "probability")),
      ownerUserId: value(formData, "ownerUserId") || null,
      nextAction: value(formData, "nextAction") || null,
      expectedCloseDate: expectedCloseDate ? `${expectedCloseDate}T00:00:00.000Z` : null,
    });
  } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(page(workspaceSlug));
}

export async function closeOpportunityAction(workspaceSlug: string, opportunityId: string, formData: FormData) {
  const stage = value(formData, "stage");
  try {
    await closeOpportunity(workspaceSlug, opportunityId, {
      stage: stage === "won" ? "won" : "lost",
      ...(stage === "won" ? {
        amount: optionalNumber(formData, "amount"),
        currency: value(formData, "currency") || null,
        offerVersionId: value(formData, "offerVersionId") || null,
      } : {
        lostReason: value(formData, "lostReason") || null,
        lostComment: value(formData, "lostComment") || null,
      }),
    });
  } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(page(workspaceSlug));
}

export async function reopenOpportunityAction(workspaceSlug: string, opportunityId: string, _formData: FormData) {
  try { await reopenOpportunity(workspaceSlug, opportunityId); }
  catch (error) { throw new Error(formatError(error)); }
  revalidatePath(page(workspaceSlug));
}

function formatError(error: unknown): string {
  if (!(error instanceof OutboundApiError)) return error instanceof Error ? error.message : "L’opération a échoué.";
  const field = error.details && typeof error.details === "object" && "field" in error.details ? ` (${String(error.details.field)})` : "";
  if (error.status === 409) return `${error.code}: Cette opportunité est verrouillée ou a changé. Actualisez la fiche avant de réessayer.`;
  if (error.status === 422) return `${error.code}${field}: Vérifiez les champs obligatoires et les valeurs saisies.`;
  return `${error.code}: ${error.message}`;
}
