"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  archiveChannelCampaign,
  campaignTransition,
  cancelOutreachAction,
  createCampaign,
  enableProspectingChannel,
  OutboundApiError,
  preflightCampaign,
  restartCampaignDiscovery,
  retryOutreachAction,
  retryChannelAssessment,
  updateCampaign,
} from "@/lib/api";

const root = (workspaceSlug: string) => `/w/${workspaceSlug}/campaigns`;
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

export async function createCampaignAction(workspaceSlug: string, formData: FormData) {
  const name = text(formData, "name");
  if (!name) throw new Error("Le nom de la campagne est obligatoire.");
  const refs = ["offerVersionId", "icpVersionId", "messagingStrategyVersionId", "aiPolicyVersionId", "sequenceVersionId"] as const;
  const values = Object.fromEntries(refs.map((key) => [key, text(formData, key)])) as Record<(typeof refs)[number], string>;
  if (Object.values(values).some((value) => !value)) throw new Error("Sélectionnez les cinq versions publiées avant de créer la campagne.");
  const campaign = await createCampaign(workspaceSlug, { name, objective: text(formData, "objective"), ...values });
  redirect(`${root(workspaceSlug)}/${campaign.id}`);
}

export async function updateCampaignAction(workspaceSlug: string, campaignId: string, formData: FormData) {
  const input: Record<string, string> = {};
  for (const key of ["name", "objective", "offerVersionId", "icpVersionId", "messagingStrategyVersionId", "aiPolicyVersionId", "sequenceVersionId"]) {
    const value = text(formData, key);
    if (value) input[key] = value;
  }
  await updateCampaign(workspaceSlug, campaignId, input);
  revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
}

export async function preflightCampaignAction(workspaceSlug: string, campaignId: string, _formData: FormData) {
  return preflightCampaign(workspaceSlug, campaignId);
}

export async function activateCampaignAction(workspaceSlug: string, campaignId: string, _formData: FormData) {
  await campaignTransition(workspaceSlug, campaignId, "activate");
  revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
}

export async function lifecycleCampaignAction(workspaceSlug: string, campaignId: string, transition: "pause" | "resume" | "archive", _formData: FormData) {
  await campaignTransition(workspaceSlug, campaignId, transition);
  revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
}

export async function cancelOutreachActionAction(workspaceSlug: string, campaignId: string, actionId: string, _formData: FormData) {
  try { await cancelOutreachAction(workspaceSlug, actionId); }
  catch (error) { throw new Error(formatApiError(error)); }
  revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
}

export async function retryOutreachActionAction(workspaceSlug: string, campaignId: string, actionId: string, _formData: FormData) {
  try { await retryOutreachAction(workspaceSlug, actionId); }
  catch (error) { throw new Error(formatApiError(error)); }
  revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
}

function formatApiError(error: unknown): string {
  return error instanceof OutboundApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "La transition a échoué.";
}

export async function restartCampaignDiscoveryAction(
  workspaceSlug: string,
  campaignId: string,
): Promise<void> {
  await restartCampaignDiscovery(workspaceSlug, campaignId);
  revalidatePath(`/w/${workspaceSlug}/campaigns`);
  revalidatePath(`/w/${workspaceSlug}/campaigns/${campaignId}`);
}

export async function enableProspectingChannelAction(
  workspaceSlug: string,
  planId: string,
  channel: "linkedin" | "email" | "whatsapp",
): Promise<void> {
  await enableProspectingChannel(workspaceSlug, planId, channel);
  revalidatePath(`/w/${workspaceSlug}/campaigns`);
  revalidatePath(`/w/${workspaceSlug}/campaigns/plans/${planId}`);
}

export async function retryChannelAssessmentAction(
  workspaceSlug: string,
  planId: string,
  assessmentId: string,
): Promise<void> {
  await retryChannelAssessment(workspaceSlug, assessmentId);
  revalidatePath(`/w/${workspaceSlug}/campaigns`);
  revalidatePath(`/w/${workspaceSlug}/campaigns/plans/${planId}`);
}

export async function archiveChannelCampaignAction(
  workspaceSlug: string,
  planId: string,
  campaignId: string,
): Promise<void> {
  await archiveChannelCampaign(workspaceSlug, campaignId);
  revalidatePath(`/w/${workspaceSlug}/campaigns`);
  revalidatePath(`/w/${workspaceSlug}/campaigns/plans/${planId}`);
}
