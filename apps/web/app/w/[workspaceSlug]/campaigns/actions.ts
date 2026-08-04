"use server";

import { revalidatePath } from "next/cache";
import {
  archiveChannelCampaign,
  enableProspectingChannel,
  restartCampaignDiscovery,
  retryChannelAssessment,
} from "@/lib/api";

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
