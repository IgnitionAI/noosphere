import { eq } from "drizzle-orm";
import type {
  WorkspaceAiModelPolicy,
  WorkspaceAiSettingsRepository,
} from "@outbound/application/workspaces/workspace-ai-settings";
import {
  aiCapabilities,
  aiProviderIds,
  aiReasoningEfforts,
  type AiCapability,
  type ModelRoute,
} from "@outbound/application/ai/model-gateway";
import type { Database } from "@outbound/infrastructure/database/client";
import { workspaceAiSettings } from "@outbound/infrastructure/database/schema";

export class PostgresWorkspaceAiSettingsRepository
  implements WorkspaceAiSettingsRepository
{
  constructor(private readonly database: Database) {}

  async find(
    workspaceId: string,
  ): Promise<(WorkspaceAiModelPolicy & { updatedAt: Date }) | null> {
    const [row] = await this.database
      .select()
      .from(workspaceAiSettings)
      .where(eq(workspaceAiSettings.workspaceId, workspaceId))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async upsert(input: {
    workspaceId: string;
    userId: string;
    researchModels: readonly string[];
    synthesisModels: readonly string[];
    defaultRoutes: readonly ModelRoute[];
    capabilityRoutes: Readonly<Partial<Record<AiCapability, readonly ModelRoute[]>>>;
    now: Date;
  }): Promise<WorkspaceAiModelPolicy & { updatedAt: Date }> {
    const [row] = await this.database
      .insert(workspaceAiSettings)
      .values({
        workspaceId: input.workspaceId,
        researchModels: [...input.researchModels],
        synthesisModels: [...input.synthesisModels],
        modelRouting: serializeRouting(input.defaultRoutes, input.capabilityRoutes),
        updatedBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: workspaceAiSettings.workspaceId,
        set: {
          researchModels: [...input.researchModels],
          synthesisModels: [...input.synthesisModels],
          modelRouting: serializeRouting(input.defaultRoutes, input.capabilityRoutes),
          updatedBy: input.userId,
          updatedAt: input.now,
        },
      })
      .returning();
    if (!row) throw new Error("WORKSPACE_AI_SETTINGS_WRITE_FAILED");
    return mapRow(row);
  }
}

function mapRow(row: typeof workspaceAiSettings.$inferSelect) {
  const routing = readRouting(row.modelRouting);
  return {
    researchModels: readModels(row.researchModels),
    synthesisModels: readModels(row.synthesisModels),
    ...routing,
    updatedAt: row.updatedAt,
  };
}

function readModels(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("WORKSPACE_AI_SETTINGS_CORRUPTED");
  }
  return value;
}

function serializeRouting(
  defaultRoutes: readonly ModelRoute[],
  capabilityRoutes: Readonly<Partial<Record<AiCapability, readonly ModelRoute[]>>>,
) {
  return {
    defaultRoutes,
    capabilityRoutes,
  };
}

function readRouting(value: unknown): Pick<WorkspaceAiModelPolicy, "defaultRoutes" | "capabilityRoutes"> {
  if (!isRecord(value)) return {};
  const defaultRoutes = readRoutes(value.defaultRoutes);
  const capabilityRoutes: Partial<Record<AiCapability, readonly ModelRoute[]>> = {};
  if (isRecord(value.capabilityRoutes)) {
    for (const capability of aiCapabilities) {
      if (!(capability in value.capabilityRoutes)) continue;
      const routes = readRoutes(value.capabilityRoutes[capability]);
      if (routes.length > 0) capabilityRoutes[capability] = routes;
    }
  }
  return {
    ...(defaultRoutes.length > 0 ? { defaultRoutes } : {}),
    ...(Object.keys(capabilityRoutes).length > 0 ? { capabilityRoutes } : {}),
  };
}

function readRoutes(value: unknown): readonly ModelRoute[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((route) => {
    if (!isRecord(route)) return [];
    if (!aiProviderIds.includes(route.provider as (typeof aiProviderIds)[number])) return [];
    if (typeof route.model !== "string" || route.model.trim().length === 0) return [];
    if (!aiReasoningEfforts.includes(route.reasoningEffort as (typeof aiReasoningEfforts)[number])) return [];
    return [{
      provider: route.provider as ModelRoute["provider"],
      model: route.model.trim(),
      reasoningEffort: route.reasoningEffort as ModelRoute["reasoningEffort"],
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
