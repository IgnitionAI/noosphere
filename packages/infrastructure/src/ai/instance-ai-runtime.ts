import type { CodexProcessRunner } from "@outbound/infrastructure/ai/codex-process-runner";
import { CodexCliModelGateway } from "@outbound/infrastructure/ai/codex-cli-model-gateway";
import { KimiChatModelGateway } from "@outbound/infrastructure/ai/kimi-model-gateway";
import { instanceAiProviders, type InstanceAiProvider } from "@outbound/application/ai/instance-ai-connections";
import { createInstanceConnectionGateway } from "@outbound/infrastructure/ai/instance-connection-gateway";
import type { WorkspaceAiAvailability } from "@outbound/application/ai/ai-availability";
import { ModelGatewayError, type ModelGateway, type StructuredModelRequest, type StructuredModelResult, type ModelRoute, type AiCapability } from "@outbound/application/ai/model-gateway";
import { routesForCapability, type WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { DatabaseExecutor } from "@outbound/infrastructure/database/client";
import { encryptSecret, decryptSecret } from "@outbound/infrastructure/security/secret-crypto";
import { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { OpenAiResponsesModelGateway } from "@outbound/infrastructure/ai/openai-model-gateway";
import { createWorkspaceAiAvailabilityFromEnvironment } from "@outbound/infrastructure/ai/workspace-ai-availability";

type Environment = Readonly<Record<string, string | undefined>>;
export function createInstanceAiRepository(database: DatabaseExecutor, environment: Environment) {
  const key = () => { const value = environment.APP_ENCRYPTION_KEY?.trim(); if (!value) throw new Error("APP_ENCRYPTION_KEY_REQUIRED"); return value; };
  return new PostgresInstanceAiConnectionsRepository(database, { encrypt: (value) => encryptSecret(value, key()), decrypt: (value) => decryptSecret(value, key()) });
}
export class InstanceWorkspaceAiPolicyReader implements WorkspaceAiModelPolicyReader {
  constructor(private readonly workspaces: WorkspaceAiModelPolicyReader, private readonly instance: Pick<PostgresInstanceAiConnectionsRepository, "getConfiguredDefault" | "getReadyRoute">) {}
  async find(workspaceId: string) {
    const workspace = await this.workspaces.find(workspaceId);
    const inherited = await this.instance.getConfiguredDefault();
    if (!workspace && !inherited) return null;
    const refresh = async (routes: readonly ModelRoute[]) => Promise.all(routes.map(async (route) => {
      if (!route.connectionId) return route;
      const ready = await this.instance.getReadyRoute({ connectionId: route.connectionId, model: route.model });
      // Keep a withdrawn choice visible and blocked instead of selecting another model.
      return ready && ready.provider === route.provider ? ready : route;
    }));
    const defaultRoutes = await refresh(workspace?.defaultRoutes?.length ? workspace.defaultRoutes : inherited ? [inherited] : []);
    const capabilityRoutes: Partial<Record<AiCapability, readonly ModelRoute[]>> = Object.fromEntries(await Promise.all(Object.entries(workspace?.capabilityRoutes ?? {}).map(async ([capability, routes]) => [capability, await refresh(routes)])));
    const researchRoutes = capabilityRoutes.icp_research?.length ? capabilityRoutes.icp_research : defaultRoutes;
    return {
      researchModels: researchRoutes.length ? researchRoutes.map((route) => route.model) : workspace?.researchModels ?? [],
      synthesisModels: researchRoutes.length ? researchRoutes.map((route) => route.model) : workspace?.synthesisModels ?? [],
      defaultRoutes,
      capabilityRoutes,
    };
  }
}
export function createInstanceWorkspaceAiAvailability(environment: Environment, policies: WorkspaceAiModelPolicyReader, instance: PostgresInstanceAiConnectionsRepository): WorkspaceAiAvailability {
  const legacy = createWorkspaceAiAvailabilityFromEnvironment(environment, policies);
  return async (workspaceId, capability) => {
    const policy = await policies.find(workspaceId);
    const routes = routesForCapability(policy, capability, []);
    if (!routes.some((route) => route.connectionId)) return legacy(workspaceId, capability);
    for (const route of routes) {
      if (route.connectionId) {
        const ready = await instance.getReadyRoute({ connectionId: route.connectionId, model: route.model });
        if (ready && (!route.connectionVersion || ready.connectionVersion === route.connectionVersion)) return true;
      }
    }
    return false;
  };
}
export class InstanceApiKeyModelGateway implements ModelGateway {
  readonly transport: "responses-api" | "anthropic-messages" | "chat-completions" | "codex-process";
  constructor(private readonly instance: PostgresInstanceAiConnectionsRepository, private readonly environment: Environment, readonly provider: InstanceAiProvider, private readonly fetcher?: (url: string, options?: RequestInit) => Promise<Response>, private readonly codexRunner?: CodexProcessRunner) {
    this.transport = provider === "openai-api" ? "responses-api" : provider === "anthropic" ? "anthropic-messages" : provider === "codex-cli" ? "codex-process" : "chat-completions";
  }
  async invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    if (!request.connectionId) {
      if (this.provider === "codex-cli") {
        const home = this.environment.CODEX_SERVICE_HOME;
        if (!home) throw unavailable(this.provider);
        return new CodexCliModelGateway({ codexHome: home, ...(this.environment.CODEX_BINARY_PATH ? { binaryPath: this.environment.CODEX_BINARY_PATH } : {}) }).invokeStructured(request);
      }
      const apiKey = this.provider === "openai-api" ? this.environment.OPENAI_API_KEY : this.provider === "kimi-code" ? this.environment.KIMI_CODE_API_KEY : undefined;
      if (!apiKey) throw unavailable(this.provider);
      return (this.provider === "kimi-code" ? new KimiChatModelGateway({ apiKey, ...(this.environment.KIMI_CODE_BASE_URL ? { baseUrl: this.environment.KIMI_CODE_BASE_URL } : {}) }) : new OpenAiResponsesModelGateway({ apiKey })).invokeStructured(request);
    }
    const route = await this.instance.getReadyRoute({ connectionId: request.connectionId, model: request.model });
    if (!route || route.provider !== this.provider || (request.connectionVersion && route.connectionVersion !== request.connectionVersion)) throw unavailable(this.provider);
    const credential = await this.instance.getCredential(request.connectionId, route.connectionVersion);
    if (!credential) throw unavailable(this.provider);
    return createInstanceConnectionGateway(credential, { environment: this.environment, ...(this.codexRunner ? { codexRunner: this.codexRunner } : {}), ...(this.fetcher ? { fetcher: this.fetcher } : {}) }).invokeStructured(request);
  }
}
export function createInstanceApiKeyGateways(instance: PostgresInstanceAiConnectionsRepository, environment: Environment, fetcher?: (url: string, options?: RequestInit) => Promise<Response>, codexRunner?: CodexProcessRunner): ModelGateway[] {
  return instanceAiProviders.map((provider) => new InstanceApiKeyModelGateway(instance, environment, provider, fetcher, codexRunner));
}
function unavailable(provider: InstanceAiProvider) { return new ModelGatewayError("AI_PROVIDER_UNAVAILABLE", provider, "AI_CONNECTION_NOT_VALIDATED", false, false); }
