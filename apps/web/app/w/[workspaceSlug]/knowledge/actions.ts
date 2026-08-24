"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createKnowledgeClaim,
  createKnowledgeSource,
  OutboundApiError,
  validateKnowledgeClaim,
  validateKnowledgeSource,
  withdrawKnowledgeSource,
  type KnowledgeSourceType,
} from "@/lib/api";

const path = (workspaceSlug: string) => `/w/${workspaceSlug}/knowledge`;

export async function createSourceAction(workspaceSlug: string, formData: FormData) {
  await run(workspaceSlug, "Source déposée en brouillon.", () => createKnowledgeSource(workspaceSlug, {
    type: String(formData.get("type")) as KnowledgeSourceType,
    title: String(formData.get("title") ?? ""),
    content: String(formData.get("content") ?? "").trim() || null,
    researchDocumentId: String(formData.get("researchDocumentId") ?? "").trim() || null,
    authorName: String(formData.get("authorName") ?? ""),
    publishedAt: new Date(String(formData.get("publishedAt") ?? "")).toISOString(),
    freshnessUntil: new Date(String(formData.get("freshnessUntil") ?? "")).toISOString(),
  }));
}

export async function validateSourceAction(workspaceSlug: string, sourceId: string) {
  await run(workspaceSlug, "Source validée et disponible pour l’IA.", () => validateKnowledgeSource(workspaceSlug, sourceId));
}

export async function withdrawSourceAction(workspaceSlug: string, sourceId: string, formData: FormData) {
  await run(workspaceSlug, "Source retirée des prochaines générations.", () => withdrawKnowledgeSource(workspaceSlug, sourceId, String(formData.get("reason") ?? "")));
}

export async function createClaimAction(workspaceSlug: string, formData: FormData) {
  await run(workspaceSlug, "Claim proposé en brouillon.", () => createKnowledgeClaim(workspaceSlug, {
    claim: String(formData.get("claim") ?? ""),
    offerClaimId: String(formData.get("offerClaimId") ?? "").trim() || null,
    sourceIds: formData.getAll("sourceIds").map(String),
  }));
}

export async function validateClaimAction(workspaceSlug: string, claimId: string) {
  await run(workspaceSlug, "Claim validé pour les prochaines générations.", () => validateKnowledgeClaim(workspaceSlug, claimId));
}

async function run(workspaceSlug: string, notice: string, mutation: () => Promise<unknown>) {
  let errorCode: string | null = null;
  try {
    await mutation();
    revalidatePath(path(workspaceSlug));
  } catch (error) {
    errorCode = error instanceof OutboundApiError ? error.code : "UPSTREAM_ERROR";
  }
  redirect(`${path(workspaceSlug)}?${errorCode ? `error=${encodeURIComponent(errorCode)}` : `notice=${encodeURIComponent(notice)}`}`);
}
