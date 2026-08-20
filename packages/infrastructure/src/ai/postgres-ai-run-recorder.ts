import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import type { Clock, IdGenerator } from "@outbound/application/shared/ports";
import type { Database } from "@outbound/infrastructure/database/client";
import { aiRuns } from "@outbound/infrastructure/database/schema";

export class PostgresAiRunRecorder implements AiRunRecorder {
  constructor(private readonly database: Database, private readonly clock: Clock, private readonly ids: IdGenerator) {}

  async record(input: Parameters<AiRunRecorder["record"]>[0]) {
    const id = this.ids.generate();
    await this.database.insert(aiRuns).values({
      id,
      workspaceId: input.workspaceId,
      purpose: input.purpose,
      contentGenerationRunId: input.contentGenerationRunId ?? null,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      promptVersionId: input.promptVersionId ?? null,
      aiConfigurationId: input.aiConfigurationId ?? null,
      shadow: input.shadow,
      inputHash: input.inputHash,
      parameters: {},
      output: input.output as never,
      status: input.status,
      cost: input.cost === null ? null : String(input.cost),
      latencyMs: input.latencyMs,
      createdAt: this.clock.now(),
    });
    return { id };
  }
}
