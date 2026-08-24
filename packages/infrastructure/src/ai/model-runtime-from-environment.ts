import { ModelRouter } from "@outbound/application/ai/model-router";
import type { WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import { CodexCliModelGateway } from "@outbound/infrastructure/ai/codex-cli-model-gateway";
import { KimiChatModelGateway } from "@outbound/infrastructure/ai/kimi-model-gateway";
import { WorkspaceStructuredModel } from "@outbound/infrastructure/ai/workspace-structured-model";

export function createWorkspaceStructuredModelFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  policies: WorkspaceAiModelPolicyReader,
): WorkspaceStructuredModel {
  const gateways = [];
  if (environment.KIMI_CODE_API_KEY) {
    gateways.push(new KimiChatModelGateway({
      apiKey: environment.KIMI_CODE_API_KEY,
      ...(environment.KIMI_CODE_BASE_URL ? { baseUrl: environment.KIMI_CODE_BASE_URL } : {}),
    }));
  }
  if (environment.CODEX_SERVICE_HOME) {
    gateways.push(new CodexCliModelGateway({
      codexHome: environment.CODEX_SERVICE_HOME,
      ...(environment.CODEX_BINARY_PATH ? { binaryPath: environment.CODEX_BINARY_PATH } : {}),
    }));
  }
  return new WorkspaceStructuredModel(new ModelRouter(gateways), policies);
}
