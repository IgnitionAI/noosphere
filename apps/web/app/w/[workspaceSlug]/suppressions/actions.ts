"use server";

import { revalidatePath } from "next/cache";
import { createSuppression, liftSuppression, type SuppressionChannel, type SuppressionIdentityType } from "@/lib/api";

const IDENTITY_TYPES: readonly SuppressionIdentityType[] = ["email", "linkedin", "phone", "whatsapp"];
const CHANNELS: readonly SuppressionChannel[] = ["global", "email", "linkedin", "whatsapp"];

export async function createSuppressionAction(workspaceSlug: string, formData: FormData) {
  const identityType = String(formData.get("identityType") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  const channel = String(formData.get("channel") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!IDENTITY_TYPES.includes(identityType as SuppressionIdentityType)) {
    throw new Error("Le type d’identité est invalide.");
  }
  if (!value) throw new Error("La valeur à supprimer est obligatoire.");
  if (!CHANNELS.includes(channel as SuppressionChannel)) {
    throw new Error("Le canal de suppression est invalide.");
  }
  await createSuppression(workspaceSlug, {
    identityType: identityType as SuppressionIdentityType,
    value,
    channel: channel as SuppressionChannel,
    reason: reason || null,
  });
  revalidatePath(`/w/${workspaceSlug}/suppressions`);
}

export async function liftSuppressionAction(
  workspaceSlug: string,
  suppressionId: string,
  formData: FormData,
) {
  const justification = String(formData.get("justification") ?? "").trim();
  if (justification.length < 3) {
    throw new Error("Une justification d’au moins 3 caractères est obligatoire.");
  }
  await liftSuppression(workspaceSlug, suppressionId, justification);
  revalidatePath(`/w/${workspaceSlug}/suppressions`);
}
