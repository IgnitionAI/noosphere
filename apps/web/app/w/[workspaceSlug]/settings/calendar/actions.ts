"use server";

import { revalidatePath } from "next/cache";
import { disconnectCalendar, updateCalendarConnection, updateCalendarMeetingTypes } from "@/lib/api";

export async function saveCalendarConnection(
  workspaceSlug: string,
  formData: FormData,
): Promise<void> {
  const bookingUrl = String(formData.get("bookingUrl") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  await updateCalendarConnection(workspaceSlug, {
    provider: "calcom",
    bookingUrl,
    ...(apiKey ? { apiKey } : {}),
  });
  revalidatePath(`/w/${workspaceSlug}/settings/calendar`);
}

export async function disconnectCalendarConnection(workspaceSlug: string): Promise<void> {
  await disconnectCalendar(workspaceSlug);
  revalidatePath(`/w/${workspaceSlug}/settings/calendar`);
}

export async function saveCalendarMeetingTypes(workspaceSlug: string, formData: FormData): Promise<void> {
  const providerEventTypeIds = formData.getAll("providerEventTypeIds").map(Number).filter(Number.isSafeInteger);
  const defaultProviderEventTypeId = Number(formData.get("defaultProviderEventTypeId"));
  await updateCalendarMeetingTypes(workspaceSlug, { providerEventTypeIds, defaultProviderEventTypeId });
  revalidatePath(`/w/${workspaceSlug}/settings/calendar`);
}
