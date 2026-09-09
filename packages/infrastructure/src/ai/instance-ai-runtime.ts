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
export class InstanceOpenAiModelGateway implements ModelGateway {
  readonly provider = "openai-api" as const;
  readonly transport = "responses-api" as const;
  constructor(private readonly instance: PostgresInstanceAiConnectionsRepository, private readonly environment: Environment) {}
  async invokeStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    if (!request.connectionId) {
      const apiKey = this.environment.OPENAI_API_KEY;
      if (!apiKey) throw unavailable();
      return new OpenAiResponsesModelGateway({ apiKey }).invokeStructured(request);
    }
    const route = await this.instance.getReadyRoute({ connectionId: request.connectionId, model: request.model });
    if (!route || route.provider !== this.provider || (request.connectionVersion && route.connectionVersion !== request.connectionVersion)) throw unavailable();
    const credential = await this.instance.getCredential(request.connectionId, route.connectionVersion);
    if (!credential) throw unavailable();
    return new OpenAiResponsesModelGateway({ apiKey: credential.apiKey, baseUrl: credential.baseUrl }).invokeStructured(request);
  }
}
function unavailable() { return new ModelGatewayError("AI_PROVIDER_UNAVAILABLE", "openai-api", "AI_CONNECTION_NOT_VALIDATED", false, false); }
