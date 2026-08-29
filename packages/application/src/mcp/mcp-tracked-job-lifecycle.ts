import type { LeasedJob } from "../jobs/job-queue";
import type { McpOperationRecord, McpOperationRef } from "./mcp-durable-operations";

const MAX_RESULT_REFS = 20;
const MAX_REF_FIELD_LENGTH = 120;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_.-]{0,119}$/;

export interface McpTrackedJobTransitionInput {
  readonly workspaceId: string;
  readonly operationId: string;
  readonly jobId: string;
  readonly now: Date;
}

export interface McpTrackedJobLifecycleStore {
  findByJob(input: { readonly workspaceId: string; readonly jobId: string }): Promise<McpOperationRecord | null>;
  findJob(input: { readonly workspaceId: string; readonly jobId: string }): Promise<McpTrackedJobStatus | null>;
  markRunning(input: McpTrackedJobTransitionInput): Promise<McpOperationRecord>;
  complete(input: McpTrackedJobTransitionInput & { readonly resultRefs: readonly McpOperationRef[] }): Promise<McpOperationRecord>;
  fail(input: McpTrackedJobTransitionInput & { readonly errorCode: string }): Promise<McpOperationRecord>;
}

export type McpTrackedJobStatus = "pending" | "running" | "retry" | "completed" | "dead_lettered";

export type McpTrackedJobContext = {
  readonly job: LeasedJob;
  readonly operation: McpOperationRecord;
  readonly transition: Omit<McpTrackedJobTransitionInput, "now">;
  readonly active: boolean;
};

export type McpTrackedJobResultResolver = (input: {
  readonly job: LeasedJob;
  readonly operation: McpOperationRecord;
}) => Promise<readonly McpOperationRef[]>;

/**
 * Mirrors a durable MCP operation onto an existing domain job. The queue and
 * domain processor retain ownership of acknowledgements and retry policy.
 */
export class McpTrackedJobLifecycle {
  constructor(
    private readonly store: McpTrackedJobLifecycleStore,
    private readonly resolveResultRefs: McpTrackedJobResultResolver,
    private readonly clock: { now(): Date },
  ) {}

  async beforeDispatch(job: LeasedJob): Promise<McpTrackedJobContext | null> {
    const operation = await this.store.findByJob({ workspaceId: job.workspaceId, jobId: job.id });
    if (!operation) return null;
    if (operation.workspaceId !== job.workspaceId || operation.jobId !== job.id) return null;

    const transition = {
      workspaceId: job.workspaceId,
      operationId: operation.operationId,
      jobId: job.id,
    } as const;
    if (isTerminal(operation.status)) {
      return { job, operation, transition, active: false };
    }

    const running = await this.store.markRunning({ ...transition, now: this.clock.now() });
    return { job, operation: running, transition, active: true };
  }

  async afterSuccess(context: McpTrackedJobContext | null): Promise<void> {
    if (!context?.active) return;
    // Processor return is not proof of durable success: domain processors may
    // return before their acknowledgement commits. Reconcile the authoritative
    // jobs row before transitioning the MCP read model.
    const status = await this.store.findJob({ workspaceId: context.job.workspaceId, jobId: context.job.id });
    if (status !== "completed" && status !== "dead_lettered") return;
    if (status === "dead_lettered") {
      await this.store.fail({ ...context.transition, errorCode: "MCP_OPERATION_FAILED", now: this.clock.now() });
      return;
    }
    const resultRefs = boundedResultRefs(await this.resolveResultRefs({ job: context.job, operation: context.operation }));
    await this.store.complete({ ...context.transition, resultRefs, now: this.clock.now() });
  }

  async afterRetry(
    context: McpTrackedJobContext | null,
    outcome: "scheduled" | "dead_lettered" | "deferred",
    error: unknown,
  ): Promise<void> {
    if (!context?.active || outcome !== "dead_lettered") return;
    await this.store.fail({
      ...context.transition,
      errorCode: safeErrorCode(error),
      now: this.clock.now(),
    });
  }
}

function isTerminal(status: McpOperationRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function boundedResultRefs(value: unknown): readonly McpOperationRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("MCP_OPERATION_RESULT_INVALID");
  if (value.length > MAX_RESULT_REFS) throw new Error("MCP_OPERATION_RESULT_REFS_TOO_LARGE");
  return value.map((ref) => {
    if (!isRecord(ref) || typeof ref.type !== "string" || typeof ref.id !== "string") {
      throw new Error("MCP_OPERATION_RESULT_INVALID");
    }
    if (ref.type.length > MAX_REF_FIELD_LENGTH || ref.id.length > MAX_REF_FIELD_LENGTH) {
      throw new Error("MCP_OPERATION_RESULT_REF_TOO_LARGE");
    }
    return { type: ref.type, id: ref.id };
  });
}

function safeErrorCode(error: unknown): string {
  const candidate = isRecord(error) && typeof error.code === "string"
    ? error.code
    : error instanceof Error ? error.message : "MCP_OPERATION_FAILED";
  return SAFE_ERROR_CODE.test(candidate) ? candidate : "MCP_OPERATION_FAILED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
