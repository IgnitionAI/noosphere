import { and, eq } from "drizzle-orm";
import type { ActiveAiConfigurationReader } from "@outbound/application/ai/active-ai-configuration";
import type { Database } from "@outbound/infrastructure/database/client";
import { aiConfigurations, aiPromptVersions } from "@outbound/infrastructure/database/schema";

export class PostgresActiveAiConfigurationReader implements ActiveAiConfigurationReader {
  constructor(private readonly database: Database) {}

  async find(workspaceId: string, capability: Parameters<ActiveAiConfigurationReader["find"]>[1]) {
    const [row] = await this.database.select({ configuration: aiConfigurations, prompt: aiPromptVersions }).from(aiConfigurations).innerJoin(aiPromptVersions, and(eq(aiPromptVersions.workspaceId, aiConfigurations.workspaceId), eq(aiPromptVersions.id, aiConfigurations.promptVersionId))).where(and(eq(aiConfigurations.workspaceId, workspaceId), eq(aiConfigurations.capability, capability), eq(aiConfigurations.status, "active"))).limit(1);
    return row ? {
      configurationId: row.configuration.id,
      capability: row.configuration.capability,
      provider: row.configuration.provider as "kimi-code" | "codex-cli" | "openai-api",
      model: row.configuration.model,
      promptVersionId: row.prompt.id,
      promptVersion: row.prompt.version,
      promptContent: row.prompt.content,
    } : null;
  }
}
