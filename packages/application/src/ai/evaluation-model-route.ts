import { aiProviderIds, type ModelRoute } from "./model-gateway";
import { AiSetupRequiredError } from "./ai-availability";
import { routesForCapability, type WorkspaceAiModelPolicy } from "../workspaces/workspace-ai-settings";

/** An evaluation compares its immutable candidate, never a substitute model. */
export function resolveEvaluationModelRoute(policy: WorkspaceAiModelPolicy | null | undefined, candidate: { provider: string; model: string }): ModelRoute {
  const provider = candidate.provider === "openai" ? "openai-api" : candidate.provider;
  if (!aiProviderIds.includes(provider as ModelRoute["provider"])) throw new AiSetupRequiredError();
  const routes = routesForCapability(policy, "evaluation", []);
  const matches = routes.filter((route) => route.provider === provider && route.model === candidate.model);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1 || routes.some((route) => route.connectionId)) throw new AiSetupRequiredError();
  // Existing environment-only installations retain explicit candidate routing.
  return { provider: provider as ModelRoute["provider"], model: candidate.model, reasoningEffort: "low" };
}
