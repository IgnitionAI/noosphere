import type { AiCapability } from "@outbound/application/ai/model-gateway";

export type WorkspaceAiAvailability = (workspaceId: string, capability: AiCapability) => Promise<boolean>;

export class AiSetupRequiredError extends Error {
  constructor() { super("AI_SETUP_REQUIRED"); }
}

export async function requireWorkspaceAi(availability: WorkspaceAiAvailability | undefined, workspaceId: string, capability: AiCapability): Promise<void> {
  if (availability && !await availability(workspaceId, capability)) throw new AiSetupRequiredError();
}
