import { and, eq, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "@outbound/infrastructure/database/client";
import { resolveEvaluationModelRoute } from "@outbound/application/ai/evaluation-model-route";
import { aiConfigurations, evaluationRuns, taskAiContexts } from "@outbound/infrastructure/database/schema";
import type { AiCapability } from "@outbound/application/ai/model-gateway";
import { AiSetupRequiredError } from "@outbound/application/ai/ai-availability";
import { createInstanceAiRepository } from "./instance-ai-runtime";
import { taskAiPolicySchema } from "./postgres-task-ai-policy-reader";
import { refreshTaskAiPolicyForResume } from "./task-ai-resume-policy";

export function createTaskAiResumePreparation(environment: Readonly<Record<string, string | undefined>>) {
  return async (tx: DatabaseTransaction, input: { workspaceId: string; taskKey: string; capability: AiCapability }) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.workspaceId} || ':' || ${input.taskKey}, 0))`);
    const [context] = await tx.select().from(taskAiContexts).where(and(eq(taskAiContexts.workspaceId, input.workspaceId), eq(taskAiContexts.taskKey, input.taskKey))).for("update");
    const parsed = taskAiPolicySchema.safeParse(context?.policy);
    if (!parsed.success) throw new AiSetupRequiredError();
    let pinned = parsed.data;
    if (input.capability === "evaluation") {
      // Older snapshots contain the complete workspace chain. Narrow it using
      // the run's immutable candidate before checking availability for resume.
      const [candidate] = await tx.select({ provider: aiConfigurations.provider, model: aiConfigurations.model }).from(evaluationRuns)
        .innerJoin(aiConfigurations, and(eq(aiConfigurations.workspaceId, evaluationRuns.workspaceId), eq(aiConfigurations.id, evaluationRuns.configurationId)))
        .where(and(eq(evaluationRuns.workspaceId, input.workspaceId), sql`'ai:run:' || ${evaluationRuns.id}::text = ${input.taskKey}`));
      if (!candidate) throw new AiSetupRequiredError();
      const route = resolveEvaluationModelRoute(pinned, candidate);
      pinned = { ...pinned, capabilityRoutes: { ...pinned.capabilityRoutes, evaluation: [route] } };
    }
    const policy = await refreshTaskAiPolicyForResume(pinned, input.capability, createInstanceAiRepository(tx, environment), environment);
    await tx.update(taskAiContexts).set({ policy }).where(and(eq(taskAiContexts.workspaceId, input.workspaceId), eq(taskAiContexts.taskKey, input.taskKey)));
    return policy;
  };
}
