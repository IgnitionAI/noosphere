"use server";

import { revalidatePath } from "next/cache";
import { setConversationAutomationMode } from "@/lib/api";

export async function setConversationAutomationAction(
  workspaceSlug: string,
  conversationId: string,
  formData: FormData,
) {
  const mode = String(formData.get("mode") ?? "");
  if (mode !== "setter" && mode !== "human" && mode !== "disabled") {
    throw new Error("Mode de conversation invalide.");
  }
  await setConversationAutomationMode(workspaceSlug, conversationId, mode);
  revalidatePath(`/w/${workspaceSlug}/inbox`);
}
