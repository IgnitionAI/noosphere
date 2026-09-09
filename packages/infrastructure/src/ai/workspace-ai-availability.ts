import type { AiCapability, ModelRoute } from "@outbound/application/ai/model-gateway";
import type { WorkspaceAiAvailability } from "@outbound/application/ai/ai-availability";
import { routesForCapability, type WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import { resolveResearchModelPolicyFromEnvironment } from "@outbound/infrastructure/ai/langchain-research-agent-executor";

/** Compatibility check for installations whose connections still come from the environment. */
export function createWorkspaceAiAvailabilityFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  policies: WorkspaceAiModelPolicyReader,
): WorkspaceAiAvailability {
  const defaults = resolveResearchModelPolicyFromEnvironment(environment);
  return async (workspaceId, capability) => {
    const fallback = routesForCapability(defaults, capability, []);
    const routes = routesForCapability(await policies.find(workspaceId), capability, fallback);
    return routes.some((route) => isEnvironmentModelRouteAvailable(environment, route, capability));
  };
}

export function isEnvironmentModelRouteAvailable(environment: Readonly<Record<string, string | undefined>>, route: ModelRoute, capability: AiCapability): boolean {
  switch (route.provider) {
    case "kimi-code": return !!environment.KIMI_CODE_API_KEY?.trim();
    case "codex-cli": return !!environment.CODEX_SERVICE_HOME?.trim();
    // Legacy research invokes OpenAI directly; other capabilities use the structured router.
    case "anthropic":
    case "openrouter":
    case "openai-compatible": return false; // Instance credentials are resolved by the shared policy reader.
    case "openai-api": return capability === "icp_research" && !!environment.OPENAI_API_KEY?.trim();
  }
}
