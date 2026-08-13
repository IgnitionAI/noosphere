"use server";

import { revalidatePath } from "next/cache";
import {
  addContactEmployment,
  addContactIdentity,
  anonymizeWorkspaceContact,
  createContact,
  enrichContact,
  improveConversationDraft,
  OutboundApiError,
  suppressContact,
  sendConversationCommand,
  retryEnrichmentJob,
  requestProspectDryRun,
  undoContactMerge,
  updateContact,
} from "@/lib/api";

export async function requestProspectDryRunAction(
  workspaceSlug: string,
  contactId: string,
  campaignId: string | null,
  formData: FormData,
) {
  const reason = String(formData.get("reason") ?? "").trim()
    || "Réévaluation manuelle demandée depuis la fiche prospect.";
  await requestProspectDryRun(workspaceSlug, contactId, reason, campaignId);
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
}

export async function improveProspectMessageAction(
  workspaceSlug: string,
  conversationId: string,
  draft: string,
) {
  const body = draft.trim();
  if (!body) throw new Error("Le brouillon est obligatoire.");
  return improveConversationDraft(workspaceSlug, conversationId, body);
}

export async function createContactAction(workspaceSlug: string, formData: FormData) {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  if (!firstName || !lastName) throw new Error("Prénom et nom sont obligatoires.");
  const email = String(formData.get("email") ?? "").trim();
  const linkedin = String(formData.get("linkedin") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  await createContact(workspaceSlug, {
    firstName,
    lastName,
    identities: [
      ...(email ? [{ type: "email", value: email }] : []),
      ...(linkedin ? [{ type: "linkedin", value: linkedin }] : []),
    ],
    ...(companyId && title ? { employment: { companyId, title } } : {}),
  });
  revalidatePath(`/w/${workspaceSlug}/prospects`);
}

export async function sendProspectMessageAction(
  workspaceSlug: string,
  contactId: string,
  conversationId: string,
  formData: FormData,
) {
  const mode = String(formData.get("mode") ?? "manual");
  if (mode !== "manual" && mode !== "setter") throw new Error("Mode d’envoi invalide.");
  const body = String(formData.get("body") ?? "").trim();
  if (mode === "manual" && !body) throw new Error("Le message est obligatoire.");
  await sendConversationCommand(workspaceSlug, conversationId, {
    mode,
    ...(body ? { body } : {}),
  });
  revalidatePath(`/w/${workspaceSlug}/prospects`);
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
  revalidatePath(`/w/${workspaceSlug}/inbox`);
}

export async function addIdentityAction(
  workspaceSlug: string,
  contactId: string,
  formData: FormData,
) {
  const type = String(formData.get("type") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  if (!value) throw new Error("La coordonnée est obligatoire.");
  await addContactIdentity(workspaceSlug, contactId, { type, value });
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
}

export async function enrichContactAction(
  workspaceSlug: string,
  contactId: string,
  formData: FormData,
) {
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if (!requestKey) throw new Error("La clé de requête d’enrichissement est obligatoire.");
  let job;
  try { job = await enrichContact(workspaceSlug, contactId, requestKey); }
  catch (error) { throw new Error(error instanceof OutboundApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "L’enrichissement a échoué."); }
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
  return job;
}

export async function retryEnrichmentJobAction(
  workspaceSlug: string,
  contactId: string,
  jobId: string,
  _formData: FormData,
) {
  let job;
  try { job = await retryEnrichmentJob(workspaceSlug, jobId); }
  catch (error) { throw new Error(error instanceof OutboundApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "La relance a échoué."); }
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
  return job;
}

export async function updateContactAction(
  workspaceSlug: string,
  contactId: string,
  formData: FormData,
) {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  if (!firstName || !lastName) throw new Error("Prénom et nom sont obligatoires.");
  const photoUrl = String(formData.get("photoUrl") ?? "").trim();
  const preferredChannel = String(formData.get("preferredChannel") ?? "").trim();
  await updateContact(workspaceSlug, contactId, {
    firstName,
    lastName,
    photoUrl: photoUrl || null,
    preferredChannel: preferredChannel || null,
  });
  revalidatePath(`/w/${workspaceSlug}/prospects`);
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
}

export async function addEmploymentAction(
  workspaceSlug: string,
  contactId: string,
  formData: FormData,
) {
  const companyId = String(formData.get("companyId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!companyId || !title) throw new Error("Entreprise et intitulé sont obligatoires.");
  await addContactEmployment(workspaceSlug, contactId, { companyId, title });
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
}

export async function suppressContactAction(
  workspaceSlug: string,
  contactId: string,
  formData: FormData,
) {
  const reason = String(formData.get("reason") ?? "").trim();
  await suppressContact(
    workspaceSlug,
    contactId,
    reason || "Suppression déclarée depuis la fiche prospect.",
  );
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
}

export async function anonymizeContactAction(
  workspaceSlug: string,
  contactId: string,
  formData: FormData,
) {
  await anonymizeWorkspaceContact(
    workspaceSlug,
    contactId,
    String(formData.get("confirmation") ?? ""),
  );
  revalidatePath(`/w/${workspaceSlug}/prospects`);
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
  revalidatePath(`/w/${workspaceSlug}/settings`);
}

export async function undoContactMergeAction(
  workspaceSlug: string,
  contactId: string,
  _formData: FormData,
) {
  await undoContactMerge(workspaceSlug, contactId);
  revalidatePath(`/w/${workspaceSlug}/prospects`);
  revalidatePath(`/w/${workspaceSlug}/prospects/${contactId}`);
}
