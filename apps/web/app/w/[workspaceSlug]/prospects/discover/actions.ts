"use server";

import { revalidatePath } from "next/cache";
import {
  importDiscoveryCandidate,
  launchDiscoveryRun,
  OutboundApiError,
  retryDiscoveryRun,
} from "@/lib/api";

const PAGE = (workspaceSlug: string) => `/w/${workspaceSlug}/prospects/discover`;

export async function launchDiscoveryAction(
  workspaceSlug: string,
  versionId: string,
  formData: FormData,
) {
  const limit = Math.min(100, Math.max(1, Number(formData.get("limit") ?? 25) || 25));
  await launchDiscoveryRun(workspaceSlug, versionId, limit);
  revalidatePath(PAGE(workspaceSlug));
}

export async function retryDiscoveryAction(
  workspaceSlug: string,
  runId: string,
  _formData: FormData,
) {
  await retryDiscoveryRun(workspaceSlug, runId);
  revalidatePath(PAGE(workspaceSlug));
}

export async function importCandidateAction(
  workspaceSlug: string,
  runId: string,
  candidateId: string,
  _formData: FormData,
) {
  try {
    await importDiscoveryCandidate(workspaceSlug, runId, candidateId);
  } catch (error) {
    if (error instanceof OutboundApiError) {
      const reason = error.code === "CONTACT_IDENTITY_CONFLICT"
        ? `${error.code}: ${error.message} Une revue humaine est nécessaire dans Doublons.`
        : error.code === "CONTACT_SUPPRESSED"
          ? `${error.code}: ${error.message} Une suppression globale active bloque cet import.`
          : `${error.code}: ${error.message}`;
      throw new Error(reason);
    }
    throw error;
  }
  revalidatePath(PAGE(workspaceSlug));
}
