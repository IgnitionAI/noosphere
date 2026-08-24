"use server";

import { generateContentFromIdea, improveContentAsset, scheduleContentPublication } from "@/lib/api";

export async function generateContentAction(workspaceSlug: string, ideaId: string) {
  return await generateContentFromIdea(workspaceSlug, ideaId, `content:generate:${crypto.randomUUID()}`);
}

export async function improveContentAction(workspaceSlug: string, assetId: string, instruction: string) {
  return await improveContentAsset(workspaceSlug, assetId, `content:improve:${crypto.randomUUID()}`, instruction);
}

export async function scheduleContentPublicationAction(workspaceSlug: string, assetId: string, scheduledFor: string) {
  return await scheduleContentPublication(workspaceSlug, assetId, `content:schedule:${crypto.randomUUID()}`, scheduledFor);
}
