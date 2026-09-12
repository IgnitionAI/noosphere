import { AiSetupRequiredError } from "@outbound/application/ai/ai-availability";
import type { AiCapability, ModelRoute } from "@outbound/application/ai/model-gateway";
import { routesForCapability, type WorkspaceAiModelPolicy } from "@outbound/application/workspaces/workspace-ai-settings";
import { isEnvironmentModelRouteAvailable } from "./workspace-ai-availability";

/** Called only by explicit resume: never derives a new selection from live defaults. */
export async function refreshTaskAiPolicyForResume(
  policy: WorkspaceAiModelPolicy,
  capability: AiCapability,
  connections: { getReadyRoute(input: { connectionId: string; model: string }): Promise<ModelRoute | null> },
  environment: Readonly<Record<string, string | undefined>>,
): Promise<WorkspaceAiModelPolicy> {
  const available = new Set<ModelRoute>();
  const refresh = async (routes: readonly ModelRoute[]) => Promise.all(routes.map(async (route) => {
    if (!route.connectionId) {
      if (isEnvironmentModelRouteAvailable(environment, route, capability)) available.add(route);
      return route;
    }
    const ready = await connections.getReadyRoute({ connectionId: route.connectionId, model: route.model });
    if (!ready || ready.connectionId !== route.connectionId || ready.provider !== route.provider || ready.model !== route.model || !ready.connectionVersion) return route;
    const refreshed = { ...route, connectionVersion: ready.connectionVersion };
    available.add(refreshed);
    return refreshed;
  }));
  const defaultRoutes = await refresh(policy.defaultRoutes ?? []);
  const capabilityRoutes = Object.fromEntries(await Promise.all(Object.entries(policy.capabilityRoutes ?? {}).map(async ([key, routes]) => [key, await refresh(routes)])));
  const researchTierRoutes = policy.researchTierRoutes ? { principal: await refresh(policy.researchTierRoutes.principal), executor: await refresh(policy.researchTierRoutes.executor) } : undefined;
  const refreshed = { ...policy, defaultRoutes, capabilityRoutes, ...(researchTierRoutes ? { researchTierRoutes } : {}) };
  if (capability === "icp_research" && researchTierRoutes) {
    if (!Object.values(researchTierRoutes).every((routes) => routes.some((route) => available.has(route)))) throw new AiSetupRequiredError();
    return refreshed;
  }
  if (!routesForCapability(refreshed, capability, []).some((route) => available.has(route))) throw new AiSetupRequiredError();
  return refreshed;
}
