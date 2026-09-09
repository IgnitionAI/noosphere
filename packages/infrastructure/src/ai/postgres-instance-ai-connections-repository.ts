import { and, eq, sql, isNull } from "drizzle-orm";
import { InstanceAiError, type InstanceAiConnectionView, type InstanceAiConnectionsRepository, type InstanceAiModel, type InstanceAiModelSelection, type InstanceAiProvider, type InstanceAiTestLease, type SaveInstanceAiConnection } from "@outbound/application/ai/instance-ai-connections";
import type { AiReasoningEffort, ModelGatewayErrorCode, ModelRoute } from "@outbound/application/ai/model-gateway";
import type { DatabaseExecutor } from "@outbound/infrastructure/database/client";
import { instanceAiConnections as connections, instanceAiModels as models, instanceAiDefaults as defaults } from "@outbound/infrastructure/database/schema";

export interface InstanceAiSecretCipher { encrypt(value: string): string; decrypt(value: string): string }
export interface InstanceAiCredential {
  readonly id: string; readonly provider: InstanceAiProvider; readonly baseUrl: string; readonly apiKey: string | null; readonly version: number;
}
export interface InstanceAiCredentialReader { getCredential(id: string, version?: number): Promise<InstanceAiCredential | null> }

export class PostgresInstanceAiConnectionsRepository implements InstanceAiConnectionsRepository, InstanceAiCredentialReader {
  constructor(private readonly database: DatabaseExecutor, private readonly cipher: InstanceAiSecretCipher) {}

  async list(): Promise<readonly InstanceAiConnectionView[]> {
    const rows = await this.database.select({ id: connections.id, name: connections.name, provider: connections.provider, baseUrl: connections.baseUrl, version: connections.version, secretConfigured: sql<boolean>`${connections.encryptedApiKey} is not null`, authenticationInProgress: sql<boolean>`${connections.authenticationSessionId} is not null` }).from(connections);
    const configuredModels = await this.database.select().from(models);
    return rows.map((row) => ({ ...row, provider: row.provider as InstanceAiProvider, models: configuredModels.filter((model) => model.connectionId === row.id).map(publicModel) }));
  }
  async listAllowed() {
    const rows = await this.database.select({ connectionId: connections.id, connectionName: connections.name, provider: connections.provider, model: models.model, reasoningEffort: models.reasoningEffort }).from(connections)
      .innerJoin(models, and(eq(models.connectionId, connections.id), eq(models.connectionVersion, connections.version), eq(models.status, "ready")))
      .where(isNull(connections.authenticationSessionId));
    return rows.map((row) => ({ ...row, provider: row.provider as ModelRoute["provider"], reasoningEffort: row.reasoningEffort as AiReasoningEffort }));
  }
  async save(input: SaveInstanceAiConnection): Promise<InstanceAiConnectionView> {
    const id = input.id ?? crypto.randomUUID();
    await this.database.transaction(async (tx) => {
      const [previous] = input.id ? await tx.select().from(connections).where(eq(connections.id, id)).for("update").limit(1) : [];
      if (input.id && !previous) throw new InstanceAiError("AI_CONNECTION_NOT_FOUND");
      if (previous && previous.provider !== input.provider) throw new InstanceAiError("AI_CONNECTION_PROVIDER_IMMUTABLE");
      if (input.provider === "codex-cli" && input.apiKey) throw new InstanceAiError("CODEX_REQUIRES_CHATGPT_LOGIN");
      if (input.provider !== "codex-cli" && !input.apiKey && !previous) throw new InstanceAiError("AI_CONNECTION_KEY_REQUIRED");
      const encryptedApiKey = input.provider === "codex-cli" ? null : input.apiKey ? this.cipher.encrypt(input.apiKey) : previous!.encryptedApiKey;
      const version = (previous?.version ?? 0) + 1;
      const values = { name: input.name, provider: input.provider, baseUrl: input.baseUrl ?? previous?.baseUrl ?? defaultBaseUrl(input.provider), encryptedApiKey, version, updatedAt: new Date() };
      if (previous) await tx.update(connections).set(values).where(eq(connections.id, id));
      else await tx.insert(connections).values({ id, ...values });
      await tx.delete(models).where(eq(models.connectionId, id));
      await tx.insert(models).values(input.models.map((model) => ({ connectionId: id, model: model.model, reasoningEffort: model.reasoningEffort, connectionVersion: version, status: "untested" })));
    });
    const result = (await this.list()).find((row) => row.id === id);
    if (!result) throw new InstanceAiError("AI_CONNECTION_NOT_FOUND");
    return result;
  }
  async beginCodexAuthentication(connectionId: string): Promise<string> {
    return this.database.transaction(async (tx) => {
      const [connection] = await tx.select().from(connections).where(eq(connections.id, connectionId)).for("update").limit(1);
      if (!connection || connection.provider !== "codex-cli") throw new InstanceAiError("CODEX_CONNECTION_NOT_FOUND");
      const version = connection.version + 1;
      const sessionId = crypto.randomUUID();
      await tx.update(connections).set({ version, authenticationSessionId: sessionId, updatedAt: new Date() }).where(eq(connections.id, connectionId));
      await tx.update(models).set({ connectionVersion: version, status: "untested", testId: null, testedAt: null, errorCode: null }).where(eq(models.connectionId, connectionId));
      return sessionId;
    });
  }
  async finishCodexAuthentication(connectionId: string, sessionId: string, publish: () => Promise<void>): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const [connection] = await tx.select().from(connections).where(eq(connections.id, connectionId)).for("update").limit(1);
      if (!connection || connection.authenticationSessionId !== sessionId) return false;
      // Publish while holding the same lock used by beginTest and connection edits.
      // If the DB commit fails, the pending session continues to block readiness.
      await publish();
      const version = connection.version + 1;
      await tx.update(connections).set({ version, authenticationSessionId: null, updatedAt: new Date() }).where(eq(connections.id, connectionId));
      await tx.update(models).set({ connectionVersion: version, status: "untested", testId: null, testedAt: null, errorCode: null }).where(eq(models.connectionId, connectionId));
      return true;
    });
  }
  async beginTest(input: InstanceAiModelSelection): Promise<InstanceAiTestLease> {
    return this.database.transaction(async (tx) => {
      const [connection] = await tx.select().from(connections).where(eq(connections.id, input.connectionId)).for("update").limit(1);
      if (!connection) throw new InstanceAiError("AI_CONNECTION_NOT_FOUND");
      if (connection.authenticationSessionId) throw new InstanceAiError("AI_CONNECTION_AUTHENTICATION_IN_PROGRESS");
      const testId = crypto.randomUUID();
      const [model] = await tx.update(models).set({ status: "testing", testId, testedAt: null, errorCode: null }).where(and(eq(models.connectionId, input.connectionId), eq(models.model, input.model), eq(models.connectionVersion, connection.version))).returning();
      if (!model) throw new InstanceAiError("AI_MODEL_NOT_AUTHORIZED");
      return { ...input, version: connection.version, testId, reasoningEffort: model.reasoningEffort as AiReasoningEffort };
    });
  }
  async finishTest(input: InstanceAiTestLease & { errorCode: ModelGatewayErrorCode | null }): Promise<boolean> {
    const rows = await this.database.update(models).set({ status: input.errorCode ? "failed" : "ready", errorCode: input.errorCode, testedAt: new Date() }).where(and(eq(models.connectionId, input.connectionId), eq(models.model, input.model), eq(models.connectionVersion, input.version), eq(models.testId, input.testId), eq(models.status, "testing"))).returning({ model: models.model });
    return rows.length === 1;
  }
  async setDefault(input: InstanceAiModelSelection): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const [connection] = await tx.select().from(connections).where(eq(connections.id, input.connectionId)).for("update").limit(1);
      if (!connection) return false;
      const [model] = await tx.select().from(models).where(and(eq(models.connectionId, input.connectionId), eq(models.model, input.model), eq(models.connectionVersion, connection.version), eq(models.status, "ready"))).limit(1);
      if (!model) return false;
      await tx.insert(defaults).values({ id: true, ...input }).onConflictDoUpdate({ target: defaults.id, set: input });
      return true;
    });
  }
  async getDefault(): Promise<(ModelRoute & { connectionId: string }) | null> {
    const [row] = await this.database.select({ connectionId: connections.id, connectionVersion: connections.version, provider: connections.provider, model: models.model, reasoningEffort: models.reasoningEffort }).from(defaults)
      .innerJoin(connections, eq(connections.id, defaults.connectionId))
      .innerJoin(models, and(eq(models.connectionId, connections.id), eq(models.model, defaults.model), eq(models.connectionVersion, connections.version), eq(models.status, "ready"))).limit(1);
    return row ? { ...row, provider: row.provider as ModelRoute["provider"], reasoningEffort: row.reasoningEffort as AiReasoningEffort } : null;
  }
  async getConfiguredDefault(): Promise<(ModelRoute & { connectionId: string }) | null> {
    const [row] = await this.database.select({ connectionId: connections.id, connectionVersion: connections.version, provider: connections.provider, model: defaults.model, reasoningEffort: models.reasoningEffort }).from(defaults)
      .innerJoin(connections, eq(connections.id, defaults.connectionId))
      .leftJoin(models, and(eq(models.connectionId, connections.id), eq(models.model, defaults.model))).limit(1);
    return row ? { ...row, provider: row.provider as ModelRoute["provider"], reasoningEffort: (row.reasoningEffort ?? "low") as AiReasoningEffort } : null;
  }
  async getReadyRoute(input: InstanceAiModelSelection): Promise<(ModelRoute & { connectionId: string; connectionVersion: number }) | null> {
    const [row] = await this.database.select({ connectionId: connections.id, connectionVersion: connections.version, provider: connections.provider, model: models.model, reasoningEffort: models.reasoningEffort }).from(connections)
      .innerJoin(models, and(eq(models.connectionId, connections.id), eq(models.model, input.model), eq(models.connectionVersion, connections.version), eq(models.status, "ready")))
      .where(and(eq(connections.id, input.connectionId), isNull(connections.authenticationSessionId))).limit(1);
    return row ? { ...row, provider: row.provider as ModelRoute["provider"], reasoningEffort: row.reasoningEffort as AiReasoningEffort } : null;
  }
  async getCredential(id: string, version?: number): Promise<InstanceAiCredential | null> {
    const [row] = await this.database.select().from(connections).where(and(eq(connections.id, id), ...(version === undefined ? [] : [eq(connections.version, version)]))).limit(1);
    return row && !row.authenticationSessionId ? { id, provider: row.provider as InstanceAiProvider, baseUrl: row.baseUrl, version: row.version, apiKey: row.encryptedApiKey ? this.cipher.decrypt(row.encryptedApiKey) : null } : null;
  }
}
function publicModel(row: typeof models.$inferSelect): InstanceAiModel {
  return { model: row.model, reasoningEffort: row.reasoningEffort as AiReasoningEffort, status: row.status as InstanceAiModel["status"], testedAt: row.testedAt, errorCode: row.errorCode as ModelGatewayErrorCode | null };
}

function defaultBaseUrl(provider: InstanceAiProvider): string {
  if (provider === "codex-cli") return "";
  if (provider === "openai-api") return "https://api.openai.com/v1";
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "kimi-code") return "https://api.kimi.com/coding/v1";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  throw new InstanceAiError("AI_CONNECTION_URL_REQUIRED");
}
