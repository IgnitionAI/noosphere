"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAiConfiguration,
  createAiPromptVersion,
  createEvaluationDataset,
  OutboundApiError,
  promoteAiConfiguration,
  recordAiFeedback,
  requestEvaluationRun,
  type AiProviderId,
  type EvaluationAiCapability,
} from "@/lib/api";

const path = (workspaceSlug: string) => `/w/${workspaceSlug}/ai-studio`;

export async function createDatasetAction(workspaceSlug: string, formData: FormData) {
  await run(workspaceSlug, "Jeu de référence créé.", async () => {
    const caseInput = parseObject(String(formData.get("caseInput") ?? ""));
    const classification = String(formData.get("classification") ?? "").trim();
    const cta = String(formData.get("ctaPresent") ?? "");
    const expected: Record<string, unknown> = {};
    if (classification) expected.classification = classification;
    if (cta === "true" || cta === "false") expected.ctaPresent = cta === "true";
    if (!Object.keys(expected).length) throw new Error("EVALUATION_CASE_EXPECTATION_REQUIRED");
    await createEvaluationDataset(workspaceSlug, {
      capability: String(formData.get("capability")) as EvaluationAiCapability,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "").trim() || null,
      rubricVersion: String(formData.get("rubricVersion") ?? "v1"),
      cases: [{ name: String(formData.get("caseName") ?? "Cas synthétique"), input: caseInput, expected }],
    });
  });
}

export async function createConfigurationAction(workspaceSlug: string, formData: FormData) {
  await run(workspaceSlug, "Configuration shadow créée.", async () => {
    const capability = String(formData.get("capability")) as EvaluationAiCapability;
    const [provider, model] = String(formData.get("modelRoute") ?? "").split("::", 2);
    if (!provider || !model) throw new Error("AI_CONFIGURATION_MODEL_NOT_ALLOWED");
    const prompt = await createAiPromptVersion(workspaceSlug, { capability, content: String(formData.get("prompt") ?? "") });
    await createAiConfiguration(workspaceSlug, { capability, provider: provider as AiProviderId, model, promptVersionId: prompt.id, status: "shadow" });
  });
}

export async function requestRunAction(workspaceSlug: string, formData: FormData) {
  await run(workspaceSlug, "Évaluation mise en file.", () => requestEvaluationRun(workspaceSlug, {
    datasetId: String(formData.get("datasetId") ?? ""),
    configurationId: String(formData.get("configurationId") ?? ""),
    requestKey: `ai-studio:${crypto.randomUUID()}`,
  }));
}

export async function promoteConfigurationAction(workspaceSlug: string, configurationId: string) {
  await run(workspaceSlug, "Configuration promue après validation humaine.", () => promoteAiConfiguration(workspaceSlug, configurationId));
}

export async function recordAiFeedbackAction(workspaceSlug: string, aiRunId: string, ratingOrFormData: -1 | 1 | FormData, submittedFormData?: FormData) {
  const rating = ratingOrFormData instanceof FormData ? 1 : ratingOrFormData;
  const formData = ratingOrFormData instanceof FormData ? ratingOrFormData : submittedFormData!;
  await run(workspaceSlug, "Feedback IA enregistré.", () => recordAiFeedback(workspaceSlug, aiRunId, { rating, reason: String(formData.get("reason") ?? "").trim() || null }));
}

async function run(workspaceSlug: string, notice: string, mutation: () => Promise<unknown>) {
  let errorCode: string | null = null;
  try {
    await mutation();
    revalidatePath(path(workspaceSlug));
  } catch (error) {
    errorCode = error instanceof OutboundApiError ? error.code : error instanceof Error ? error.message : "UPSTREAM_ERROR";
  }
  redirect(`${path(workspaceSlug)}?${errorCode ? `error=${encodeURIComponent(errorCode)}` : `notice=${encodeURIComponent(notice)}`}`);
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("EVALUATION_CASE_INPUT_INVALID");
  return parsed as Record<string, unknown>;
}
