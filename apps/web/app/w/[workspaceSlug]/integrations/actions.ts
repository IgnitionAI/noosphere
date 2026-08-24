"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  acknowledgeAccountHealthAlert,
  checkConnectedAccount,
  connectConnectedAccount,
  disconnectConnectedAccount,
  OutboundApiError,
  reconnectConnectedAccount,
  startConnectedAccountOnboarding,
  type OnboardingChannel,
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

export async function startOnboardingAction(workspaceSlug: string, formData: FormData) {
  const channel = value(formData, "channel") as OnboardingChannel;
  if (!["email", "linkedin", "whatsapp"].includes(channel)) throw new Error("Sélectionnez un canal valide.");
  try {
    const onboarding = await startConnectedAccountOnboarding(workspaceSlug, channel);
    revalidatePath(path(workspaceSlug));
    redirect(`${path(workspaceSlug)}?onboardingId=${onboarding.id}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    throw new Error(formatError(error));
  }
}

export async function acknowledgeHealthAlertAction(workspaceSlug: string, alertId: string, _formData: FormData) {
  try {
    await acknowledgeAccountHealthAlert(workspaceSlug, alertId);
  } catch (error) { throw new Error(formatError(error)); }
  revalidatePath(`/w/${workspaceSlug}`, "layout");
}

function formatError(error: unknown): string {
  if (!(error instanceof OutboundApiError)) return error instanceof Error ? error.message : "L’opération a échoué.";
  return `${error.code}: ${error.message}`;
}

function isRedirectError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT"));
}
