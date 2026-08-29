import type { McpExecutionContext } from "./mcp-read-capabilities";
import type { McpWriteCommand, McpWriteToolName } from "./mcp-write-capabilities";

export type McpOperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type McpOperationRef = {
  readonly type: string;
  readonly id: string;
};

/** The intentionally narrow public projection returned by operation_get and
 * the durable operation resource. Internal identity, request and provider
 * fields are never part of this shape. */
export interface McpOperationView {
  readonly operationId: string;
  readonly jobId: string;
  readonly correlationId: string;
  readonly status: McpOperationStatus;
  readonly resultRefs: readonly McpOperationRef[];
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly operationUri: string;
}

const SAFE_OPERATION_ERROR_CODE = /^[A-Z][A-Z0-9_.-]{0,119}$/;
const MAX_PUBLIC_RESULT_REFS = 20;
const MAX_PUBLIC_REF_FIELD_LENGTH = 120;

export function toMcpOperationView(record: McpOperationRecord): McpOperationView {
  return {
    operationId: record.operationId,
    jobId: record.jobId,
    correlationId: record.correlationId,
    status: record.status,
    resultRefs: record.resultRefs.slice(0, MAX_PUBLIC_RESULT_REFS).filter((ref) => (
      ref.type.length > 0 && ref.type.length <= MAX_PUBLIC_REF_FIELD_LENGTH
      && ref.id.length > 0 && ref.id.length <= MAX_PUBLIC_REF_FIELD_LENGTH
    )),
    errorCode: record.errorCode && SAFE_OPERATION_ERROR_CODE.test(record.errorCode) ? record.errorCode : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    operationUri: record.operationUri,
  };
}

export interface McpOperationRecord {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly userId: string;
  readonly tool: McpWriteToolName;
  readonly requestKey: string;
  readonly inputHash: string;
  readonly jobId: string;
  readonly correlationId: string;
  readonly status: McpOperationStatus;
  readonly resultRefs: readonly McpOperationRef[];
  readonly errorCode: string | null;
  readonly operationUri: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface McpOperationStore {
  createQueued(input: {
    readonly context: McpExecutionContext;
    readonly command: McpWriteCommand;
    readonly operationId: string;
    readonly jobId: string;
    readonly correlationId: string;
    readonly resultRefs?: readonly McpOperationRef[];
    readonly now: Date;
  }): Promise<{ readonly record: McpOperationRecord; readonly inserted: boolean }>;
  get(input: { readonly workspaceId: string; readonly operationId: string }): Promise<McpOperationRecord | null>;
}
