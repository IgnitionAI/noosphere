import { and, eq, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "@outbound/infrastructure/database/client";
import { taskAiContexts } from "@outbound/infrastructure/database/schema";
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
    const policy = await refreshTaskAiPolicyForResume(parsed.data, input.capability, createInstanceAiRepository(tx, environment), environment);
    await tx.update(taskAiContexts).set({ policy }).where(and(eq(taskAiContexts.workspaceId, input.workspaceId), eq(taskAiContexts.taskKey, input.taskKey)));
    return policy;
  };
}
