"use server";
import { redirect } from "next/navigation";
import { skipInstanceAiSetup } from "@/lib/api";
export async function skipSetupAction(): Promise<void> {
  try { await skipInstanceAiSetup(); }
  catch { redirect("/setup?error=skip"); }
  redirect("/onboarding");
}

export async function saveConnectionAction(form: FormData) {
  const { saveInstanceAiConnection, OutboundApiError } = await import("@/lib/api");
  let error: string | null = null;
  try {
    const id = String(form.get("connectionId") ?? "").trim();
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const provider = String(form.get("provider") ?? "openai-api") as import("@/lib/api").InstanceAiConnectionSummary["provider"];
    const baseUrl = String(form.get("baseUrl") ?? "").trim();
    const models = [...new Set(String(form.get("models") ?? "").split(/[\n,]+/).map((value) => value.trim()).filter(Boolean))];
    await saveInstanceAiConnection({ ...(id ? { id } : {}), name: String(form.get("name") ?? "").trim(), provider, ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}), models: models.map((model) => ({ model, reasoningEffort: "low" })) });
  } catch (cause) { error = cause instanceof OutboundApiError ? cause.code : "AI_CONNECTION_STORAGE_UNAVAILABLE"; }
  redirect(error ? `/setup?error=${encodeURIComponent(error)}` : "/setup?notice=saved");
}
export async function testConnectionAction(connectionId: string, model: string, _form: FormData) {
  const { testInstanceAiModel, OutboundApiError } = await import("@/lib/api");
  let error: string | null = null;
  try { const result = await testInstanceAiModel({ connectionId, model }); error = result.errorCode; }
  catch (cause) { error = cause instanceof OutboundApiError ? cause.code : "AI_PROVIDER_UNAVAILABLE"; }
  redirect(error ? `/setup?error=${encodeURIComponent(error)}` : "/setup?notice=tested");
}
export async function selectDefaultAction(connectionId: string, model: string, form: FormData) {
  const { selectInstanceAiDefault, OutboundApiError } = await import("@/lib/api");
  let error: string | null = null;
  try {
    const selected = String(form.get("fallback") ?? "");
    const fallback = selected ? JSON.parse(selected) as { connectionId: string; model: string } : null;
    await selectInstanceAiDefault({ connectionId, model, ...(form.has("fallback") ? { fallback } : {}) });
  }
  catch (cause) { error = cause instanceof OutboundApiError ? cause.code : "AI_CONNECTION_NOT_VALIDATED"; }
  redirect(error ? `/setup?error=${encodeURIComponent(error)}` : "/setup?notice=default");
}

export async function chatGptLoginAction(connectionId: string, begin: boolean) {
  const { instanceChatGptLogin } = await import("@/lib/api");
  try { return await instanceChatGptLogin(connectionId, begin); }
  catch { return { state: "failed" as const }; }
}
