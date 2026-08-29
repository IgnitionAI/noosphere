import type { McpExecutionContext } from "./mcp-read-capabilities";
export type { McpExecutionContext } from "./mcp-read-capabilities";

export type McpWriteToolName =
  | "company_upsert" | "contact_upsert" | "opportunity_update" | "opportunity_change_stage"
  | "prospect_add_note" | "content_idea_create" | "content_draft_create" | "prospect_schedule_dry_run";
export type McpWriteArguments = { readonly [Name in McpWriteToolName]: Readonly<Record<string, unknown>> };

export interface McpWriteResult {
  readonly id: string;
  readonly version: number;
  readonly state: string;
  readonly status?: string;
  readonly operation: McpWriteToolName;
  readonly correlationId: string;
  readonly operationId?: string;
  readonly jobId?: string;
  readonly operationUri?: string;
  readonly auditId?: string;
}

export interface McpWriteCommand<Name extends McpWriteToolName = McpWriteToolName> {
  readonly operation: Name;
  readonly requestKey: string;
  readonly inputHash: string;
  readonly arguments: McpWriteArguments[Name];
}

export interface McpWriteLedger {
  run<Name extends McpWriteToolName>(
    context: McpExecutionContext,
    command: McpWriteCommand<Name>,
    effect: () => Promise<McpWriteResult>,
  ): Promise<McpWriteResult>;
  readonly recordAudit?: (context: McpExecutionContext, tool: McpWriteToolName, outcome: string) => Promise<void>;
}

/** Application-side write port. Implementations must never call providers. */
export interface McpWriteCapabilities {
  execute<Name extends McpWriteToolName>(
    context: McpExecutionContext,
    command: McpWriteCommand<Name>,
  ): Promise<McpWriteResult>;
  /** Optional durable audit hook used for denials before command parsing. */
  readonly recordAudit?: (context: McpExecutionContext, tool: McpWriteToolName, outcome: string) => Promise<void>;
}

export function createMcpWriteCapabilities(
  ledger: McpWriteLedger,
  effect: <Name extends McpWriteToolName>(context: McpExecutionContext, command: McpWriteCommand<Name>) => Promise<McpWriteResult>,
): McpWriteCapabilities {
  const audit = typeof ledger.recordAudit === "function"
    ? (context: McpExecutionContext, tool: McpWriteToolName, outcome: string) => ledger.recordAudit!(context, tool, outcome)
    : undefined;
  return Object.freeze({
    execute: <Name extends McpWriteToolName>(context: McpExecutionContext, command: McpWriteCommand<Name>) => ledger.run(context, command, () => effect(context, command)),
    ...(audit ? { recordAudit: audit } : {}),
  });
}

/** Compare a persisted entity revision before a mutation; stale callers never overwrite. */
export function assertMcpExpectedRevision(expected: number | undefined, current: number): number {
  if (!Number.isSafeInteger(current) || current < 1) throw new Error("MCP_WRITE_REVISION_INVALID");
  if (expected !== undefined && expected !== current) throw new Error("MCP_WRITE_VERSION_CONFLICT");
  return current;
}
