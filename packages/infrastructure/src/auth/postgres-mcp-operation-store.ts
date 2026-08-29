import { and, asc, eq, inArray } from "drizzle-orm";
import type { McpOperationRecord, McpOperationStore, McpOperationRef } from "@outbound/application/mcp/mcp-durable-operations";
import type { McpTrackedJobLifecycleStore, McpTrackedJobStatus } from "@outbound/application/mcp/mcp-tracked-job-lifecycle";
import type { McpWriteCommand } from "@outbound/application/mcp/mcp-write-capabilities";
import type { DatabaseExecutor } from "@outbound/infrastructure/database/client";
import { jobs, mcpOperations } from "@outbound/infrastructure/database/schema";

const MAX_RESULT_REFS = 20;
const MAX_REF_FIELD_LENGTH = 120;
const MAX_RECONCILIATION_BATCH = 100;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_.-]{0,119}$/;

type TransitionInput = {
  readonly workspaceId: string;
  readonly operationId: string;
  readonly jobId: string;
  readonly now: Date;
};

export class PostgresMcpOperationStore implements McpOperationStore, McpTrackedJobLifecycleStore {
  constructor(private readonly database: DatabaseExecutor) {}

  async createQueued(input: {
    readonly context: { readonly workspaceId: string; readonly clientId: string; readonly userId: string };
    readonly command: McpWriteCommand;
    readonly operationId: string;
    readonly jobId: string;
    readonly correlationId: string;
    readonly resultRefs?: readonly McpOperationRef[];
    readonly now: Date;
  }): Promise<{ readonly record: McpOperationRecord; readonly inserted: boolean }> {
    const resultRefs = input.resultRefs ?? [];
    validateResultRefs(resultRefs);
    const [inserted] = await this.database.insert(mcpOperations).values({
      operationId: input.operationId,
      workspaceId: input.context.workspaceId,
      clientId: input.context.clientId,
      userId: input.context.userId,
      tool: input.command.operation,
      requestKey: input.command.requestKey,
      inputHash: input.command.inputHash,
      jobId: input.jobId,
      correlationId: input.correlationId,
      status: "queued",
      resultRefs: [...resultRefs],
      errorCode: null,
      createdAt: input.now,
      updatedAt: input.now,
    }).onConflictDoNothing().returning();

    if (inserted) return { record: toRecord(inserted), inserted: true };

    const [existing] = await this.database.select().from(mcpOperations).where(and(
      eq(mcpOperations.workspaceId, input.context.workspaceId),
      eq(mcpOperations.clientId, input.context.clientId),
      eq(mcpOperations.tool, input.command.operation),
      eq(mcpOperations.requestKey, input.command.requestKey),
    )).limit(1);
    if (!existing) throw new Error("MCP_OPERATION_NOT_FOUND");
    if (existing.inputHash !== input.command.inputHash) throw new Error("MCP_OPERATION_IDEMPOTENCY_CONFLICT");
    return { record: toRecord(existing), inserted: false };
  }

  async get(input: { readonly workspaceId: string; readonly operationId: string }): Promise<McpOperationRecord | null> {
    const [row] = await this.database.select().from(mcpOperations).where(and(
      eq(mcpOperations.workspaceId, input.workspaceId),
      eq(mcpOperations.operationId, input.operationId),
    )).limit(1);
    return row ? toRecord(row) : null;
  }

  async findByJob(input: { readonly workspaceId: string; readonly jobId: string }): Promise<McpOperationRecord | null> {
    const [row] = await this.database.select().from(mcpOperations).where(and(
      eq(mcpOperations.workspaceId, input.workspaceId),
      eq(mcpOperations.jobId, input.jobId),
    )).limit(1);
    return row ? toRecord(row) : null;
  }

  async findJob(input: { readonly workspaceId: string; readonly jobId: string }): Promise<McpTrackedJobStatus | null> {
    const [row] = await this.database.select({ status: jobs.status }).from(jobs).where(and(
      eq(jobs.workspaceId, input.workspaceId),
      eq(jobs.id, input.jobId),
    )).limit(1);
    return row ? row.status as McpTrackedJobStatus : null;
  }

  async reconcileJobOutcomes(limit = 100): Promise<number> {
    const batchSize = boundedBatchSize(limit);
    const rows = await this.database.select({
      operationId: mcpOperations.operationId,
      workspaceId: mcpOperations.workspaceId,
      jobId: mcpOperations.jobId,
      jobStatus: jobs.status,
      payload: jobs.payload,
      errorCode: jobs.lastErrorCode,
    }).from(mcpOperations).innerJoin(jobs, and(
      eq(jobs.id, mcpOperations.jobId),
      eq(jobs.workspaceId, mcpOperations.workspaceId),
    )).where(and(
      inArray(mcpOperations.status, ["queued", "running"]),
      inArray(jobs.status, ["completed", "dead_lettered"]),
    )).orderBy(asc(mcpOperations.updatedAt), asc(mcpOperations.operationId)).limit(batchSize);
    let count = 0;
    for (const row of rows) {
      const values = row.jobStatus === "completed"
        ? { status: "completed", resultRefs: persistedResultRefs(row.payload), errorCode: null, updatedAt: new Date() }
        : { status: "failed", resultRefs: [], errorCode: safeErrorCode(row.errorCode), updatedAt: new Date() };
      const updated = await this.database.update(mcpOperations).set(values).where(and(
        eq(mcpOperations.workspaceId, row.workspaceId),
        eq(mcpOperations.operationId, row.operationId),
        eq(mcpOperations.jobId, row.jobId),
        inArray(mcpOperations.status, ["queued", "running"]),
      )).returning({ operationId: mcpOperations.operationId });
      count += updated.length;
    }
    return count;
  }

  async markRunning(input: TransitionInput): Promise<McpOperationRecord> {
    // A worker can crash after this transition and before the domain effect.
    // Reclaimed leases must be able to resume the same durable operation.
    return this.transition(input, ["queued", "running"], { status: "running", updatedAt: input.now });
  }

  async complete(input: TransitionInput & { readonly resultRefs: readonly McpOperationRef[] }): Promise<McpOperationRecord> {
    validateResultRefs(input.resultRefs);
    return this.transition(input, "running", { status: "completed", resultRefs: [...input.resultRefs], errorCode: null, updatedAt: input.now });
  }

  async fail(input: TransitionInput & { readonly errorCode: string }): Promise<McpOperationRecord> {
    if (input.errorCode.length > MAX_REF_FIELD_LENGTH) throw new Error("MCP_OPERATION_ERROR_CODE_TOO_LARGE");
    return this.transition(input, "running", { status: "failed", resultRefs: [], errorCode: input.errorCode, updatedAt: input.now });
  }

  async cancel(input: TransitionInput): Promise<McpOperationRecord> {
    return this.transition(input, ["queued", "running"], { status: "cancelled", updatedAt: input.now });
  }

  private async transition(
    input: TransitionInput,
    expected: string | readonly string[],
    values: Partial<typeof mcpOperations.$inferInsert>,
  ): Promise<McpOperationRecord> {
    const expectedStatuses = typeof expected === "string" ? [expected] : expected;
    const [updated] = await this.database.update(mcpOperations).set(values).where(and(
      eq(mcpOperations.workspaceId, input.workspaceId),
      eq(mcpOperations.operationId, input.operationId),
      eq(mcpOperations.jobId, input.jobId),
      inArray(mcpOperations.status, expectedStatuses),
    )).returning();
    if (updated) return toRecord(updated);

    const [current] = await this.database.select({
      operationId: mcpOperations.operationId,
      jobId: mcpOperations.jobId,
      status: mcpOperations.status,
    }).from(mcpOperations).where(and(
      eq(mcpOperations.workspaceId, input.workspaceId),
      eq(mcpOperations.operationId, input.operationId),
    )).limit(1);
    if (!current) throw new Error("MCP_OPERATION_NOT_FOUND");
    if (current.jobId !== input.jobId) throw new Error("MCP_OPERATION_LEASE_LOST");
    throw new Error("MCP_OPERATION_INVALID_STATE");
  }
}

function validateResultRefs(resultRefs: readonly McpOperationRef[]): void {
  if (resultRefs.length > MAX_RESULT_REFS) throw new Error("MCP_OPERATION_RESULT_REFS_TOO_LARGE");
  for (const resultRef of resultRefs) {
    if (resultRef.type.length > MAX_REF_FIELD_LENGTH || resultRef.id.length > MAX_REF_FIELD_LENGTH) {
      throw new Error("MCP_OPERATION_RESULT_REF_TOO_LARGE");
    }
  }
}

function persistedResultRefs(payload: unknown): Array<{ type: string; id: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const refs = (payload as Record<string, unknown>).mcpResultRefs;
  if (!Array.isArray(refs)) return [];
  return refs.filter((ref): ref is { type: string; id: string } => (
    !!ref && typeof ref === "object" && !Array.isArray(ref)
    && typeof (ref as Record<string, unknown>).type === "string"
    && typeof (ref as Record<string, unknown>).id === "string"
    && (ref as { type: string; id: string }).type.length <= MAX_REF_FIELD_LENGTH
    && (ref as { type: string; id: string }).id.length <= MAX_REF_FIELD_LENGTH
  )).slice(0, MAX_RESULT_REFS);
}

function boundedBatchSize(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_RECONCILIATION_BATCH;
  return Math.min(MAX_RECONCILIATION_BATCH, Math.max(1, Math.floor(limit)));
}

function safeErrorCode(value: unknown): string {
  return typeof value === "string" && SAFE_ERROR_CODE.test(value)
    ? value
    : "MCP_OPERATION_FAILED";
}

function toRecord(row: typeof mcpOperations.$inferSelect): McpOperationRecord {
  return {
    operationId: row.operationId,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    userId: row.userId,
    tool: row.tool as McpOperationRecord["tool"],
    requestKey: row.requestKey,
    inputHash: row.inputHash,
    jobId: row.jobId,
    correlationId: row.correlationId,
    status: row.status as McpOperationRecord["status"],
    resultRefs: row.resultRefs,
    errorCode: row.errorCode,
    operationUri: `noosphere://operations/${row.operationId}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
