"use server";

import { revalidatePath } from "next/cache";
import { selectWhatsAppChannelAccount } from "@/lib/api";

export async function saveWhatsAppAccount(
  workspaceSlug: string,
  formData: FormData,
): Promise<void> {
  const providerAccountId = String(formData.get("providerAccountId") ?? "").trim();
  if (!providerAccountId) throw new Error("Sélectionnez un compte WhatsApp");
  await selectWhatsAppChannelAccount(workspaceSlug, providerAccountId);
  revalidatePath(`/w/${workspaceSlug}/settings/channels`);
}
