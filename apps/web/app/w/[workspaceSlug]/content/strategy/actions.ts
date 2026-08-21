"use server";

import { configureContentAutopilot, deriveEditorialStrategy, publishEditorialStrategy } from "@/lib/api";

export async function deriveStrategyAction(workspaceSlug: string) {
  return deriveEditorialStrategy(workspaceSlug, `strategy:derive:${crypto.randomUUID()}`);
}

export async function publishStrategyAction(workspaceSlug: string) {
  return publishEditorialStrategy(workspaceSlug, `strategy:publish:${crypto.randomUUID()}`);
}

export async function configureAutopilotAction(workspaceSlug: string, input: { enabled: boolean; localTime: string; timezone: string }) {
  return configureContentAutopilot(workspaceSlug, { requestKey: `autopilot:configure:${crypto.randomUUID()}`, ...input });
}
