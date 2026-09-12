"use server";

import { OutboundApiError, configureContentAutopilot, deriveEditorialStrategy, publishEditorialStrategy, updateContentBrandKit, type ContentBrandKit } from "@/lib/api";

export async function deriveStrategyAction(workspaceSlug: string) {
  return deriveEditorialStrategy(workspaceSlug, `strategy:derive:${crypto.randomUUID()}`);
}

export async function updateBrandKitAction(workspaceSlug: string, brandKit: ContentBrandKit["snapshot"]) {
  return updateContentBrandKit(workspaceSlug, { requestKey: `brand-kit:update:${crypto.randomUUID()}`, brandKit });
}

export async function publishStrategyAction(workspaceSlug: string) {
  return publishEditorialStrategy(workspaceSlug, `strategy:publish:${crypto.randomUUID()}`);
}

export async function configureAutopilotAction(workspaceSlug: string, input: { enabled: boolean; localTime: string; timezone: string; publicationTimes?: readonly string[]; publicationDays?: readonly number[] }) {
  try {
    await configureContentAutopilot(workspaceSlug, { requestKey: `autopilot:configure:${crypto.randomUUID()}`, ...input });
    return { ok: true } as const;
  } catch (cause) {
    if (cause instanceof OutboundApiError && cause.code === "CONTENT_AUTOPILOT_ACTIVE_STRATEGY_REQUIRED") {
      return { ok: false, code: cause.code, message: "Vous devez valider la stratégie avant de démarrer l’Inbound." } as const;
    }
    return { ok: false, code: "CONTENT_AUTOPILOT_CONFIGURATION_FAILED", message: "La configuration de l’Inbound n’a pas pu être enregistrée. Réessayez dans un instant." } as const;
  }
}
