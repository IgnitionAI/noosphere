import type { ResearchToolRunRecorder } from "@outbound/infrastructure/ai/research-tools";
import type { Database } from "@outbound/infrastructure/database/client";
import { aiToolRuns } from "@outbound/infrastructure/database/schema";

export class PostgresResearchToolRunRecorder implements ResearchToolRunRecorder {
  constructor(private readonly db: Database) {}

  async record(input: Parameters<ResearchToolRunRecorder["record"]>[0]): Promise<void> {
    await this.db.insert(aiToolRuns).values({
      workspaceId: input.workspaceId,
      productResearchRunId: input.runId,
      researchStageRunId: null,
      correlationId: input.correlationId,
      toolName: input.toolName,
      status: input.status,
      input: input.toolInput,
      outputMetadata: input.outputMetadata,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode,
    });
  }
}
