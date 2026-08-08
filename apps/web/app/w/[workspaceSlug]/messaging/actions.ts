"use server";

import { revalidatePath } from "next/cache";
import {
  createAIPolicy,
  createMessagingStrategy,
  OutboundApiError,
  publishAIPolicy,
  publishMessagingStrategy,
  updateAIPolicy,
  updateMessagingStrategy,
  type AIPolicyRules,
  type MessagingChannel,
  type MessagingStrategyRules,
} from "@/lib/api";

const CHANNELS: readonly MessagingChannel[] = ["linkedin", "email", "whatsapp"];

export async function createMessagingSetupAction(workspaceSlug: string, _formData: FormData) {
  await Promise.all([
    createMessagingStrategy(workspaceSlug, { name: "Stratégie de message", rules: emptyStrategyRules() }),
    createAIPolicy(workspaceSlug, { name: "Politique de supervision", rules: defaultPolicyRules() }),
  ]);
  revalidatePath(`/w/${workspaceSlug}/messaging`);
}

export async function createMessagingStrategyAction(workspaceSlug: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de la stratégie est obligatoire.");
  await createMessagingStrategy(workspaceSlug, { name, rules: emptyStrategyRules() });
  revalidatePath(`/w/${workspaceSlug}/messaging`);
}

export async function createAIPolicyAction(workspaceSlug: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de la politique est obligatoire.");
  await createAIPolicy(workspaceSlug, { name, rules: defaultPolicyRules() });
  revalidatePath(`/w/${workspaceSlug}/messaging`);
}

export async function updateMessagingStrategyAction(workspaceSlug: string, strategyId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de la stratégie est obligatoire.");
  const allowedClaimIds = String(formData.get("allowedClaimIds") ?? "").split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
  const rules: MessagingStrategyRules = {
    tone: String(formData.get("tone") ?? ""),
    angle: String(formData.get("angle") ?? ""),
    templates: CHANNELS.flatMap((channel) => {
      const body = String(formData.get(`${channel}.body`) ?? "");
      const subject = String(formData.get(`${channel}.subject`) ?? "");
      const cta = String(formData.get(`${channel}.cta`) ?? "");
      const maxLengthRaw = String(formData.get(`${channel}.maxLength`) ?? "").trim();
      const constraintsRaw = String(formData.get(`${channel}.constraints`) ?? "").trim();
      if (!body.trim() && !subject.trim() && !cta.trim() && !maxLengthRaw) return [];
      const maxLength = Number(maxLengthRaw);
      const constraints = parseConstraints(constraintsRaw);
      return [{
        channel,
        body,
        ...(subject.trim() ? { subject } : {}),
        ...(Number.isInteger(maxLength) && maxLength > 0 ? { maxLength } : {}),
        ...(cta.trim() ? { cta } : {}),
        ...(constraints ? { constraints } : {}),
      }];
    }),
    allowedClaimIds,
    ...(String(formData.get("offerVersionId") ?? "").trim() ? { offerVersionId: String(formData.get("offerVersionId")).trim() } : {}),
  };
  await updateMessagingStrategy(workspaceSlug, strategyId, { name, rules });
  revalidatePath(`/w/${workspaceSlug}/messaging`);
}

function parseConstraints(value: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("json");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Les contraintes de canal doivent être un objet JSON valide.");
  }
}

export async function updateAIPolicyAction(workspaceSlug: string, policyId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom de la politique est obligatoire.");
  const escalationRaw = String(formData.get("escalationRules") ?? "").trim();
  let escalationRules: Record<string, unknown> | undefined;
  if (escalationRaw) {
    try {
      const parsed: unknown = JSON.parse(escalationRaw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("json");
      escalationRules = parsed as Record<string, unknown>;
    } catch {
      throw new Error("Les règles d’escalade doivent être un objet JSON valide.");
    }
  }
  const rules: AIPolicyRules = {
    firstContactRequiresHumanApproval: true,
    responsesRequireHumanApproval: true,
    followUpsMayBeAutomated: formData.get("followUpsMayBeAutomated") === "on",
    ...(escalationRules ? { escalationRules } : {}),
  };
  await updateAIPolicy(workspaceSlug, policyId, { name, rules });
  revalidatePath(`/w/${workspaceSlug}/messaging`);
}

export async function publishMessagingStrategyAction(workspaceSlug: string, strategyId: string, _formData: FormData) {
  try {
    await publishMessagingStrategy(workspaceSlug, strategyId);
  } catch (error) {
    throw new Error(formatPublicationError(error));
  }
  revalidatePath(`/w/${workspaceSlug}/messaging`);
}

export async function publishAIPolicyAction(workspaceSlug: string, policyId: string, _formData: FormData) {
  try {
    await publishAIPolicy(workspaceSlug, policyId);
  } catch (error) {
    throw new Error(error instanceof OutboundApiError ? error.message : "La publication de la politique a échoué.");
  }
  revalidatePath(`/w/${workspaceSlug}/messaging`);
}

function emptyStrategyRules(): MessagingStrategyRules {
  return { tone: "", angle: "", templates: [], allowedClaimIds: [] };
}
function defaultPolicyRules(): AIPolicyRules {
  return { firstContactRequiresHumanApproval: true, responsesRequireHumanApproval: true, followUpsMayBeAutomated: false };
}
function formatPublicationError(error: unknown): string {
  if (!(error instanceof OutboundApiError)) return "La publication de la stratégie a échoué.";
  if (error.code === "MESSAGING_CLAIMS_INVALID") {
    const ids = Array.isArray((error.details as { blockedClaimIds?: unknown } | null)?.blockedClaimIds)
      ? ((error.details as { blockedClaimIds: unknown[] }).blockedClaimIds).join(", ")
      : "références non validées";
    return `Claims bloquants (hypothesis ou invalidated) : ${ids}`;
  }
  if (error.code === "MESSAGING_STRATEGY_INVALID") {
    const errors = (error.details as { errors?: unknown } | null)?.errors;
    if (Array.isArray(errors)) {
      return errors.map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const row = item as { path?: string; message?: string; variables?: string[] };
        return `${row.path ?? "Stratégie"} : ${row.message ?? "blocage de publication"}${row.variables?.length ? ` (${row.variables.join(", ")})` : ""}`;
      }).join("\n");
    }
  }
  return error.message;
}
