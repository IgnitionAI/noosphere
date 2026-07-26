import { eq } from "drizzle-orm";
import type {
  WorkspaceAiModelPolicy,
  WorkspaceAiSettingsRepository,
} from "@outbound/application/workspaces/workspace-ai-settings";
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
    now: Date;
  }): Promise<WorkspaceAiModelPolicy & { updatedAt: Date }> {
    const [row] = await this.database
      .insert(workspaceAiSettings)
      .values({
        workspaceId: input.workspaceId,
        researchModels: [...input.researchModels],
        synthesisModels: [...input.synthesisModels],
        updatedBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: workspaceAiSettings.workspaceId,
        set: {
          researchModels: [...input.researchModels],
          synthesisModels: [...input.synthesisModels],
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
  return {
    researchModels: readModels(row.researchModels),
    synthesisModels: readModels(row.synthesisModels),
    updatedAt: row.updatedAt,
  };
}

function readModels(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("WORKSPACE_AI_SETTINGS_CORRUPTED");
  }
  return value;
}
