import { z } from "zod";
import { aiCapabilities, aiProviderIds, aiReasoningEfforts } from "@outbound/application/ai/model-gateway";
import type { WorkspaceAiModelPolicy } from "@outbound/application/workspaces/workspace-ai-settings";
import type { SqlClient } from "@outbound/infrastructure/database/client";
import type { TaskAiPolicyReader } from "@outbound/infrastructure/ai/task-ai-policy-scope";

const route = z.object({
  provider: z.enum(aiProviderIds), model: z.string().min(1), reasoningEffort: z.enum(aiReasoningEfforts),
  connectionId: z.string().uuid().optional(), connectionVersion: z.number().int().positive().optional(),
}).transform(({ connectionId, connectionVersion, ...rest }) => ({ ...rest, ...(connectionId ? { connectionId } : {}), ...(connectionVersion ? { connectionVersion } : {}) }));
export const taskAiPolicySchema = z.object({
  researchModels: z.array(z.string()), synthesisModels: z.array(z.string()),
  defaultRoutes: z.array(route), capabilityRoutes: z.partialRecord(z.enum(aiCapabilities), z.array(route)),
});

export class PostgresTaskAiPolicyReader implements TaskAiPolicyReader {
  constructor(private readonly sql: SqlClient) {}
  async find(jobId: string, workspaceId: string): Promise<WorkspaceAiModelPolicy | null> {
    const [row] = await this.sql`select ai_policy from jobs where id = ${jobId} and workspace_id = ${workspaceId}`;
    if (!row) throw new Error("JOB_AI_CONTEXT_NOT_FOUND");
    if (row.ai_policy === null) throw new Error("JOB_AI_CONTEXT_MIGRATION_REQUIRED");
    const parsed = taskAiPolicySchema.safeParse(row.ai_policy);
    if (!parsed.success) throw new Error("JOB_AI_CONTEXT_INVALID");
    return parsed.data;
  }
}
