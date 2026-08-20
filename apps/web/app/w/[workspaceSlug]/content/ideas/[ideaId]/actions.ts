"use server";

import { generateContentFromIdea, improveContentAsset } from "@/lib/api";

export async function generateContentAction(workspaceSlug: string, ideaId: string) {
  return await generateContentFromIdea(workspaceSlug, ideaId, `content:generate:${crypto.randomUUID()}`);
}

export async function improveContentAction(workspaceSlug: string, assetId: string, instruction: string) {
  return await improveContentAsset(workspaceSlug, assetId, `content:improve:${crypto.randomUUID()}`, instruction);
}
