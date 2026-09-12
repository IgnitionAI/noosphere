import { ModelGatewayError, type ModelGateway } from "@outbound/application/ai/model-gateway";
import { OpenAiResponsesModelGateway } from "@outbound/infrastructure/ai/openai-model-gateway";
import { ApiKeyModelGateway } from "@outbound/infrastructure/ai/api-key-model-gateway";
import { KimiChatModelGateway } from "@outbound/infrastructure/ai/kimi-model-gateway";
import { CodexCliModelGateway } from "@outbound/infrastructure/ai/codex-cli-model-gateway";
import type { CodexProcessRunner } from "@outbound/infrastructure/ai/codex-process-runner";
import { instanceCodexHome } from "@outbound/infrastructure/ai/instance-codex-home";
import type { InstanceAiCredential } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";

export interface InstanceConnectionGatewayOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: (url: string, options?: RequestInit) => Promise<Response>;
  readonly maxOutputTokens?: number;
  readonly codexRunner?: CodexProcessRunner;
}
export function createInstanceConnectionGateway(credential: InstanceAiCredential, options: InstanceConnectionGatewayOptions = {}): ModelGateway {
  if (credential.provider === "codex-cli") {
    const environment = options.environment ?? process.env;
    return new CodexCliModelGateway({ isolatedService: true, codexHome: instanceCodexHome(environment, credential.id),
      ...(environment.CODEX_BINARY_PATH ? { binaryPath: environment.CODEX_BINARY_PATH } : {}),
      ...(options.codexRunner ? { runner: options.codexRunner } : {}),
    });
  }
  if (!credential.apiKey) throw new ModelGatewayError("AI_PROVIDER_AUTHENTICATION_FAILED", credential.provider, "AI_CONNECTION_KEY_REQUIRED", false, false);
  const common = { apiKey: credential.apiKey, baseUrl: credential.baseUrl,
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  };
  if (credential.provider === "openai-api") return new OpenAiResponsesModelGateway(common);
  if (credential.provider === "kimi-code") return new KimiChatModelGateway(common);
  return new ApiKeyModelGateway({ ...common, provider: credential.provider });
}
