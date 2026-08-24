"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { OutboundApiError, requeueConsoleJob } from "@/lib/api";

export async function requeueJobAction(workspaceSlug: string, jobId: string) {
  let error: string | null = null;
  try {
    await requeueConsoleJob(workspaceSlug, jobId);
    revalidatePath(`/w/${workspaceSlug}/settings/console`);
  } catch (cause) {
    error = cause instanceof OutboundApiError ? cause.code : "UPSTREAM_ERROR";
  }
  redirect(`/w/${workspaceSlug}/settings/console?${error ? `error=${encodeURIComponent(error)}` : `notice=${encodeURIComponent("État métier réparé et traitement remis en file.")}`}`);
}
