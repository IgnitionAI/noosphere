import { instanceAiProviders, type InstanceAiProvider } from "@outbound/application/ai/instance-ai-connections";
import { ApiKeyModelGateway } from "@outbound/infrastructure/ai/api-key-model-gateway";
import type { WorkspaceAiAvailability } from "@outbound/application/ai/ai-availability";
import { ModelGatewayError, type ModelGateway, type StructuredModelRequest, type StructuredModelResult } from "@outbound/application/ai/model-gateway";
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
  constructor(private readonly workspaces: WorkspaceAiModelPolicyReader, private readonly instance: PostgresInstanceAiConnectionsRepository) {}
  async find(workspaceId: string) {
    const workspace = await this.workspaces.find(workspaceId);
    if (workspace) return workspace;
    const route = await this.instance.getConfiguredDefault();
    return route ? { researchModels: [route.model], synthesisModels: [route.model], defaultRoutes: [route], capabilityRoutes: {} } : null;
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
  readonly transport: "responses-api" | "anthropic-messages" | "chat-completions";
  constructor(private readonly instance: PostgresInstanceAiConnectionsRepository, private readonly environment: Environment, readonly provider: InstanceAiProvider, private readonly fetcher?: (url: string, options?: RequestInit) => Promise<Response>) {
    this.transport = provider === "openai-api" ? "responses-api" : provider === "anthropic" ? "anthropic-messages" : "chat-completions";
  }
  async invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    if (!request.connectionId) {
      const apiKey = this.provider === "openai-api" ? this.environment.OPENAI_API_KEY : undefined;
      if (!apiKey) throw unavailable(this.provider);
      return new OpenAiResponsesModelGateway({ apiKey }).invokeStructured(request);
    }
    const route = await this.instance.getReadyRoute({ connectionId: request.connectionId, model: request.model });
    if (!route || route.provider !== this.provider || (request.connectionVersion && route.connectionVersion !== request.connectionVersion)) throw unavailable(this.provider);
    const credential = await this.instance.getCredential(request.connectionId, route.connectionVersion);
    if (!credential) throw unavailable(this.provider);
    const options = { apiKey: credential.apiKey, baseUrl: credential.baseUrl, ...(this.fetcher ? { fetcher: this.fetcher } : {}) };
    return (this.provider === "openai-api" ? new OpenAiResponsesModelGateway(options)
      : new ApiKeyModelGateway({ ...options, provider: this.provider })).invokeStructured(request);
  }
}
export function createInstanceApiKeyGateways(instance: PostgresInstanceAiConnectionsRepository, environment: Environment, fetcher?: (url: string, options?: RequestInit) => Promise<Response>): ModelGateway[] {
  return instanceAiProviders.map((provider) => new InstanceApiKeyModelGateway(instance, environment, provider, fetcher));
}
function unavailable(provider: InstanceAiProvider) { return new ModelGatewayError("AI_PROVIDER_UNAVAILABLE", provider, "AI_CONNECTION_NOT_VALIDATED", false, false); }
