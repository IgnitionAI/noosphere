"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  OutboundApiError,
  requestWorkspaceDataExport,
  updateWorkspaceChannelLimits,
  updateWorkspaceProfile,
  updateWorkspaceRetentionPolicy,
  updateWorkspaceSendingPreferences,
} from "@/lib/api";

const path = (workspaceSlug: string) => `/w/${workspaceSlug}/settings`;

export async function updateProfileAction(workspaceSlug: string, workspaceId: string, formData: FormData) {
  await run(workspaceSlug, "Profil du workspace mis à jour.", () => updateWorkspaceProfile(workspaceSlug, workspaceId, String(formData.get("name") ?? "")));
}

export async function updateSendingAction(workspaceSlug: string, workspaceId: string, formData: FormData) {
  await run(workspaceSlug, "Préférences d’envoi mises à jour.", () => updateWorkspaceSendingPreferences(workspaceSlug, workspaceId, {
    timezone: String(formData.get("timezone") ?? "Europe/Paris"),
    activeDays: formData.getAll("activeDays").map(Number),
    windowStart: String(formData.get("windowStart") ?? "09:00"),
    windowEnd: String(formData.get("windowEnd") ?? "17:00"),
  }));
}

export async function updateLimitsAction(workspaceSlug: string, workspaceId: string, formData: FormData) {
  await run(workspaceSlug, "Limites quotidiennes mises à jour.", () => updateWorkspaceChannelLimits(workspaceSlug, workspaceId, {
    linkedin: Number(formData.get("linkedin")),
    email: Number(formData.get("email")),
    whatsapp: Number(formData.get("whatsapp")),
  }));
}

export async function updateRetentionAction(workspaceSlug: string, workspaceId: string, formData: FormData) {
  await run(workspaceSlug, "Politique de rétention enregistrée. Toute purge nécessaire est planifiée.", () => updateWorkspaceRetentionPolicy(workspaceSlug, workspaceId, {
    invitationsDays: Number(formData.get("invitationsDays")),
    jobsDays: Number(formData.get("jobsDays")),
    auditDays: Number(formData.get("auditDays")),
  }, String(formData.get("confirmation") ?? "")));
}

export async function requestExportAction(workspaceSlug: string, workspaceId: string, formData: FormData) {
  let exportId: string | null = null;
  let errorCode: string | null = null;
  try {
    const result = await requestWorkspaceDataExport(workspaceSlug, workspaceId, String(formData.get("requestKey") ?? ""));
    exportId = result.id;
    revalidatePath(path(workspaceSlug));
  } catch (error) {
    errorCode = error instanceof OutboundApiError ? error.code : "UPSTREAM_ERROR";
  }
  redirect(`${path(workspaceSlug)}?${exportId ? `exportId=${encodeURIComponent(exportId)}&notice=${encodeURIComponent("Export lancé.")}` : `error=${encodeURIComponent(errorCode ?? "UPSTREAM_ERROR")}`}#data`);
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
