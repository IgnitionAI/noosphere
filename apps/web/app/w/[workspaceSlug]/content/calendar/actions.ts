"use server";

import { cancelContentPublication, rescheduleContentPublication } from "@/lib/api";

export async function cancelPublicationAction(workspaceSlug: string, publicationId: string) {
  return await cancelContentPublication(workspaceSlug, publicationId, `content:cancel:${crypto.randomUUID()}`);
}

export async function reschedulePublicationAction(workspaceSlug: string, publicationId: string, scheduledFor: string) {
  return await rescheduleContentPublication(workspaceSlug, publicationId, `content:reschedule:${crypto.randomUUID()}`, scheduledFor);
}
