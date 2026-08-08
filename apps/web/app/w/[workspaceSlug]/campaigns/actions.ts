"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  campaignTransition,
  createCampaign,
  OutboundApiError,
  preflightCampaign,
  updateCampaign,
} from "@/lib/api";

const root = (workspaceSlug: string) => `/w/${workspaceSlug}/campaigns`;

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

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
  try {
    const result = await preflightCampaign(workspaceSlug, campaignId);
    revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
    return result;
  } catch (error) {
    if (error instanceof OutboundApiError) throw new Error(`${error.code}: ${error.message}`);
    throw error;
  }
}

export async function activateCampaignAction(workspaceSlug: string, campaignId: string, _formData: FormData) {
  try { await campaignTransition(workspaceSlug, campaignId, "activate"); }
  catch (error) { throw new Error(formatApiError(error)); }
  revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
}

export async function lifecycleCampaignAction(workspaceSlug: string, campaignId: string, transition: "pause" | "resume" | "archive", _formData: FormData) {
  try { await campaignTransition(workspaceSlug, campaignId, transition); }
  catch (error) { throw new Error(formatApiError(error)); }
  revalidatePath(`${root(workspaceSlug)}/${campaignId}`);
}

function formatApiError(error: unknown): string {
  if (!(error instanceof OutboundApiError)) return error instanceof Error ? error.message : "La transition a échoué.";
  const details = error.details as { blockers?: unknown[]; warnings?: unknown[] } | null;
  const blockers = Array.isArray(details?.blockers) ? details.blockers : [];
  return blockers.length ? `${error.code}: ${error.message}\n${blockers.map((item) => {
    const blocker = item as { reference?: string; message?: string };
    return `${blocker.reference ?? "référence"}: ${blocker.message ?? error.message}`;
  }).join("\n")}` : `${error.code}: ${error.message}`;
}
