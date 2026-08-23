"use server";

import { revalidatePath } from "next/cache";
import {
  selectChannelAccount,
  type ChannelConnectionChannel,
} from "@/lib/api";

export async function saveChannelAccount(
  workspaceSlug: string,
  channel: ChannelConnectionChannel,
  formData: FormData,
): Promise<void> {
  const providerAccountId = String(formData.get("providerAccountId") ?? "").trim();
  if (!providerAccountId) throw new Error("Sélectionnez un compte");
  await selectChannelAccount(workspaceSlug, channel, providerAccountId);
  revalidatePath(`/w/${workspaceSlug}/settings/channels`);
}
