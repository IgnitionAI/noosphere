"use server";

import { revalidatePath } from "next/cache";
import {
  enrollCampaignProspect,
  excludeCampaignProspect,
  OutboundApiError,
  selectCampaignProspects,
} from "@/lib/api";

const root = (workspaceSlug: string, campaignId: string) => `/w/${workspaceSlug}/campaigns/${campaignId}`;
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

export async function selectProspectsAction(workspaceSlug: string, campaignId: string, formData: FormData) {
  const contactIds = text(formData, "contactIds").split(",").map((value) => value.trim()).filter(Boolean);
  if (!contactIds.length) throw new Error("Sélectionnez au moins un prospect.");
  try { await selectCampaignProspects(workspaceSlug, campaignId, contactIds); } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(root(workspaceSlug, campaignId));
}

export async function enrollProspectAction(workspaceSlug: string, campaignId: string, contactId: string, _formData: FormData) {
  try { await enrollCampaignProspect(workspaceSlug, campaignId, contactId); } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(root(workspaceSlug, campaignId));
}

export async function excludeProspectAction(workspaceSlug: string, campaignId: string, contactId: string, formData: FormData) {
  const reason = text(formData, "reason");
  if (!reason) throw new Error("La raison d’exclusion est obligatoire.");
  try { await excludeCampaignProspect(workspaceSlug, campaignId, contactId, reason); } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(root(workspaceSlug, campaignId));
}

function formatError(error: unknown): string {
  if (!(error instanceof OutboundApiError)) return error instanceof Error ? error.message : "L’opération a échoué.";
  const details = error.details as { campaignName?: string; reason?: string; channel?: string } | null;
  if (error.code === "ACTIVE_SEQUENCE_CONFLICT") return `${error.code}: Ce contact est déjà dans la campagne active « ${details?.campaignName ?? "autre campagne"} ».`;
  if (error.code === "ENROLLMENT_SUPPRESSED") return `${error.code}: Enrollment refusé, suppression globale active${details?.reason ? ` (${details.reason})` : ""}.`;
  if (error.code === "NO_VALID_CHANNEL") return `${error.code}: Aucun canal valide pour ce contact${details?.channel ? ` (${details.channel})` : ""}.`;
  return `${error.code}: ${error.message}`;
}
