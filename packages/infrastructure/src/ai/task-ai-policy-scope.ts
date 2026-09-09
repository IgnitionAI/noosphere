import { AsyncLocalStorage } from "node:async_hooks";
import type { JobExecutionContext } from "@outbound/application/jobs/job-execution-context";
import type { WorkspaceAiModelPolicy, WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";

export interface TaskAiPolicyReader {
  find(jobId: string, workspaceId: string): Promise<WorkspaceAiModelPolicy | null>;
}

/** Each concurrent worker job reads its durable launch policy, including later executor reads. */
export class TaskAiPolicyScope implements WorkspaceAiModelPolicyReader, JobExecutionContext {
  private readonly storage = new AsyncLocalStorage<{ workspaceId: string; policy: WorkspaceAiModelPolicy | null }>();
  constructor(private readonly live: WorkspaceAiModelPolicyReader, private readonly snapshots: TaskAiPolicyReader) {}

  async find(workspaceId: string) {
    const active = this.storage.getStore();
    if (active?.workspaceId === workspaceId) return active.policy;
    return this.live.find(workspaceId);
  }

  async run<T>(job: { readonly id: string; readonly workspaceId: string }, execute: () => Promise<T>): Promise<T> {
    const policy = await this.snapshots.find(job.id, job.workspaceId);
    return this.storage.run({ workspaceId: job.workspaceId, policy }, execute);
  }
}
