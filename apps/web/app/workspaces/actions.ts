"use server";

import { redirect } from "next/navigation";
import { createWorkspace, OutboundApiError } from "@/lib/api";

export async function createWorkspaceAction(returnPath: string, formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  let workspaceSlug: string | null = null;
  let errorCode: string | null = null;
  try {
    const workspace = await createWorkspace({ name, ...(slug ? { slug } : {}) });
    workspaceSlug = workspace.slug;
  } catch (error) {
    errorCode = error instanceof OutboundApiError ? error.code : "UPSTREAM_ERROR";
  }
  if (workspaceSlug) redirect(`/onboarding?workspace=${encodeURIComponent(workspaceSlug)}`);
  redirect(`${returnPath}?error=${encodeURIComponent(errorCode ?? "UPSTREAM_ERROR")}`);
}
