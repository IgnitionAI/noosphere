import { createHash } from "node:crypto";
import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";
import type {
  McpEffectProposal,
  McpEffectStatusView,
  McpGovernedEffectCapabilities,
  McpGovernedEffectKind,
  McpGovernedEffectStatus,
  McpPrepareCommand,
} from "@outbound/application/mcp/mcp-governed-effects";
import { redactMcpReadValue } from "@outbound/interface/mcp/mcp-read-contracts";
import {
  MCP_GOVERNED_EFFECT_TOOL_NAMES,
  mcpGovernedEffectToolArgumentsSchema,
  parseMcpGovernedEffectArguments,
  type McpGovernedEffectToolArguments,
  type McpGovernedEffectToolName,
} from "@outbound/interface/mcp/mcp-governed-effect-contracts";
import * as z from "zod/v4";

const PREPARE_ROLES = new Set(["operator", "admin", "owner"]);
const DECISION_ROLES = new Set(["reviewer", "admin", "owner"]);
const DECISION_SCOPES = ["mcp:read", "mcp:write", "mcp:approve"] as const;
const STABLE_ERROR = /^(?:MCP_EFFECT|MCP_GOVERNED_EFFECT)_[A-Z0-9_]+$/;

/** Register the seven provider-free governed-effect tools on a request-local server. */
export function registerMcpGovernedEffectTools(
  server: McpServer,
  capabilities: McpGovernedEffectCapabilities,
  context: McpExecutionContext,
): void {
  for (const name of MCP_GOVERNED_EFFECT_TOOL_NAMES) {
    register(server, name, mcpGovernedEffectToolArgumentsSchema[name], capabilities, context);
  }
}

function register<Name extends McpGovernedEffectToolName>(
  server: McpServer,
  name: Name,
  inputSchema: StandardSchemaWithJSON,
  capabilities: McpGovernedEffectCapabilities,
  context: McpExecutionContext,
): void {
  server.registerTool(name, {
    description: `Workspace-governed ${name.replaceAll("_", " ")} operation.`,
    inputSchema,
  }, async (raw) => {
    try {
      const parsed = parseMcpGovernedEffectArguments(name, raw) as McpGovernedEffectToolArguments[Name];
      if (isPrepareTool(name)) {
        requirePrepareAuthority(context);
        return toolResult(projectProposal(await capabilities.prepare(context, prepareCommand(name, parsed as McpGovernedEffectToolArguments[PrepareToolName])), context));
      }
      if (name === "approval_list") {
        requireReadScope(context);
        const input = parsed as McpGovernedEffectToolArguments["approval_list"];
        const listInput = input.status === undefined ? { limit: input.limit } : { status: input.status, limit: input.limit };
        const values = await capabilities.list(context, listInput);
        return toolResult({ data: values.slice(0, input.limit).map((value) => projectStatus(value, context)) });
      }
      if (name === "approval_get") {
        requireReadScope(context);
        const input = parsed as McpGovernedEffectToolArguments["approval_get"];
        const statusInput = input.proposalId === undefined ? { approvalItemId: input.approvalItemId! } : { proposalId: input.proposalId };
        const value = await capabilities.status(context, statusInput);
        if (value === null) return toolError("MCP_GOVERNED_EFFECT_NOT_FOUND");
        return toolResult(projectStatus(value, context));
      }
      requireDecisionAuthority(context);
      const input = parsed as McpGovernedEffectToolArguments["approval_decide"];
      const decisionInput = input.justification === undefined
        ? { approvalItemId: input.approvalItemId, decision: input.decision }
        : { approvalItemId: input.approvalItemId, decision: input.decision, justification: input.justification };
      return toolResult(projectStatus(await capabilities.decide(context, decisionInput), context));
    } catch (error) {
      return toolError(mapError(error));
    }
  });
}

type PrepareToolName =
  | "conversation_prepare_reply"
  | "content_prepare_publication"
  | "meeting_prepare_proposal"
  | "campaign_prepare_activation";

function isPrepareTool(name: McpGovernedEffectToolName): name is PrepareToolName {
  return name === "conversation_prepare_reply"
    || name === "content_prepare_publication"
    || name === "meeting_prepare_proposal"
    || name === "campaign_prepare_activation";
}

function requirePrepareAuthority(context: McpExecutionContext): void {
  if (!PREPARE_ROLES.has(context.role)) throw new Error("MCP_GOVERNED_EFFECT_FORBIDDEN");
  if (!context.scopes.includes("mcp:write")) throw new Error("MCP_GOVERNED_EFFECT_SCOPE_REQUIRED");
}

function requireReadScope(context: McpExecutionContext): void {
  if (!context.scopes.includes("mcp:read")) throw new Error("MCP_GOVERNED_EFFECT_SCOPE_REQUIRED");
}

function requireDecisionAuthority(context: McpExecutionContext): void {
  if (!DECISION_ROLES.has(context.role)) throw new Error("MCP_GOVERNED_EFFECT_FORBIDDEN");
  if (!DECISION_SCOPES.every((scope) => context.scopes.includes(scope))) {
    throw new Error("MCP_GOVERNED_EFFECT_SCOPE_REQUIRED");
  }
}

function prepareCommand(name: PrepareToolName, value: McpGovernedEffectToolArguments[PrepareToolName]): McpPrepareCommand {
  const input = value as Record<string, unknown>;
  const requestKey = input.requestKey as string;
  const inputHash = hashInput(input);
  switch (name) {
    case "conversation_prepare_reply":
      return { kind: "conversation_reply", requestKey, inputHash, conversationId: input.conversationId as string, body: input.body as string, ...optionalVersion(input) };
    case "content_prepare_publication":
      return { kind: "content_publication", requestKey, inputHash, assetId: input.assetId as string, ...optionalField(input, "assetVersionId"), ...optionalField(input, "scheduledFor"), ...optionalVersion(input) };
    case "meeting_prepare_proposal":
      return { kind: "meeting_proposal", requestKey, inputHash, meetingProposalId: input.meetingProposalId as string, slotPosition: input.slotPosition as number, ...optionalVersion(input) };
    case "campaign_prepare_activation":
      return { kind: "campaign_activation", requestKey, inputHash, campaignId: input.campaignId as string, ...optionalVersion(input) };
  }
}

function optionalVersion(input: Record<string, unknown>): { readonly expectedVersion?: number } {
  return typeof input.expectedVersion === "number" ? { expectedVersion: input.expectedVersion } : {};
}

function optionalField<T extends "assetVersionId" | "scheduledFor">(
  input: Record<string, unknown>,
  key: T,
): { readonly [Key in T]?: string } {
  return typeof input[key] === "string" ? { [key]: input[key] } as { readonly [Key in T]?: string } : {};
}

function hashInput(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return value === undefined ? "null" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
}

function projectProposal(value: McpEffectProposal, context: McpExecutionContext): Record<string, unknown> {
  return {
    proposalId: boundedString(value.proposalId),
    workspaceId: context.workspaceId,
    kind: boundedKind(value.kind),
    status: boundedStatus(value.status),
    approvalItemId: nullableString(value.approvalItemId),
    correlationId: boundedString(value.correlationId),
    version: boundedVersion(value.version),
    revision: boundedVersion(value.revision),
    sourceVersion: boundedVersion(value.sourceVersion),
    createdAt: boundedString(value.createdAt),
    updatedAt: boundedString(value.updatedAt),
  };
}

function projectStatus(value: McpEffectStatusView, context: McpExecutionContext): Record<string, unknown> {
  const projection: Record<string, unknown> = {
    ...projectProposal(value, context),
    policyCode: safeCode(value.policyCode),
    operationId: nullableString(value.operationId),
    jobId: nullableString(value.jobId),
    reconciliationId: nullableString(value.reconciliationId),
    approvalDecision: value.approvalDecision === "approve" || value.approvalDecision === "reject" ? value.approvalDecision : null,
    intent: DECISION_ROLES.has(context.role) && value.intent ? projectIntent(value.intent) : null,
    redacted: true,
  };
  return redactMcpReadValue(projection, context.role) as Record<string, unknown>;
}

function projectIntent(value: NonNullable<McpEffectStatusView["intent"]>): Record<string, unknown> {
  return {
    kind: boundedKind(value.kind),
    aggregateId: boundedString(value.aggregateId),
    ...(boundedText(value.body, 10_000) ? { body: boundedText(value.body, 10_000) } : {}),
    ...(boundedText(value.subject, 2_000) ? { subject: boundedText(value.subject, 2_000) } : {}),
    ...(boundedText(value.slotStart, 120) ? { slotStart: boundedText(value.slotStart, 120) } : {}),
    ...(boundedText(value.slotEnd, 120) ? { slotEnd: boundedText(value.slotEnd, 120) } : {}),
    ...(boundedText(value.timeZone, 120) ? { timeZone: boundedText(value.timeZone, 120) } : {}),
    revision: boundedVersion(value.revision),
    sourceVersion: boundedVersion(value.sourceVersion),
  };
}

function boundedString(value: unknown, max = 180): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : boundedString(value);
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

function boundedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000_000 ? value : null;
}

function boundedKind(value: unknown): McpGovernedEffectKind | null {
  return value === "conversation_reply" || value === "content_publication" || value === "meeting_proposal" || value === "campaign_activation" ? value : null;
}

function boundedStatus(value: unknown): McpGovernedEffectStatus | null {
  return value === "approval_required" || value === "policy_denied" || value === "queued" || value === "accepted" || value === "unknown"
    || value === "reconciling" || value === "delivered" || value === "failed" || value === "rejected" || value === "invalidated" ? value : null;
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9_.-]{0,159}$/.test(value) ? value : null;
}

function mapError(error: unknown): string {
  if (error instanceof z.ZodError) return "MCP_GOVERNED_EFFECT_VALIDATION_FAILED";
  const message = error instanceof Error ? error.message : "";
  return STABLE_ERROR.test(message) ? message : "MCP_GOVERNED_EFFECT_FAILED";
}

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

function toolError(code: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: code }) }],
    structuredContent: { error: code },
  };
}
