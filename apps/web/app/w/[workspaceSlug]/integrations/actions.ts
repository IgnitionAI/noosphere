"use server";

import { revalidatePath } from "next/cache";
import {
  checkConnectedAccount,
  connectConnectedAccount,
  disconnectConnectedAccount,
  OutboundApiError,
  reconnectConnectedAccount,
} from "@/lib/api";

const path = (workspaceSlug: string) => `/w/${workspaceSlug}/integrations`;
const value = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

export async function connectAccountAction(workspaceSlug: string, formData: FormData) {
  const providerAccountId = value(formData, "providerAccountId");
  const accessToken = value(formData, "accessToken");
  if (!providerAccountId || !accessToken) throw new Error("L’identifiant du compte et le secret sont obligatoires.");
  try {
    await connectConnectedAccount(workspaceSlug, { providerAccountId, accessToken, ...(value(formData, "displayName") ? { displayName: value(formData, "displayName") } : {}) });
  } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(path(workspaceSlug));
}

export async function accountAction(workspaceSlug: string, accountId: string, action: "check" | "reconnect" | "disconnect", _formData: FormData) {
  try {
    if (action === "check") await checkConnectedAccount(workspaceSlug, accountId);
    else if (action === "reconnect") await reconnectConnectedAccount(workspaceSlug, accountId);
    else await disconnectConnectedAccount(workspaceSlug, accountId);
  } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(path(workspaceSlug));
}

function formatError(error: unknown): string {
  if (!(error instanceof OutboundApiError)) return error instanceof Error ? error.message : "L’opération a échoué.";
  return `${error.code}: ${error.message}`;
}
