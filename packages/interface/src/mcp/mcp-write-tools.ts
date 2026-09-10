import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { McpExecutionContext, McpWriteCapabilities, McpWriteResult } from "@outbound/application/mcp/mcp-write-capabilities";
import { canonicalMcpWriteHash, isMcpWriteRoleAllowed, mcpWriteToolArgumentsSchema, parseMcpWriteArguments, type McpWriteArguments, type McpWriteToolName } from "@outbound/interface/mcp/mcp-write-contracts";

const STABLE_WRITE_ERRORS = new Set(["MCP_WRITE_IDEMPOTENCY_CONFLICT", "MCP_WRITE_VERSION_CONFLICT", "MCP_WRITE_IN_PROGRESS", "MCP_WRITE_RECOVERY_REQUIRED", "WRITE_NOT_FOUND", "WRITE_FORBIDDEN", "WRITE_SCOPE_REQUIRED", "WRITE_RATE_LIMITED"]);
const STABLE_DOMAIN_ERROR = /^(?:OFFER|PRODUCT_RESEARCH|CAMPAIGN|CONVERSATION|KNOWLEDGE|CONTENT_AUTOPILOT)_[A-Z0-9_]+$/;
const TOOL_DESCRIPTIONS: Readonly<Record<McpWriteToolName, string>> = {
  company_upsert: "Create or update a company in the current workspace.",
  contact_upsert: "Create or update a contact in the current workspace.",
  opportunity_update: "Update the value, probability or next action of an opportunity.",
  opportunity_change_stage: "Move an opportunity to another pipeline stage.",
  prospect_add_note: "Add an internal note to a prospect.",
  content_idea_create: "Create a LinkedIn content idea without publishing it.",
  content_draft_create: "Create a durable content draft without publishing it.",
  prospect_schedule_dry_run: "Simulate a prospect action without contacting a provider.",
  offer_create: "Create a product or service offer draft.",
  offer_update: "Update an offer draft, its positioning, claims or objections.",
  offer_publish: "Publish an immutable offer version for campaign and agent context.",
  research_launch: "Launch a durable ICP research run that continues after this chat turn.",
  campaign_create: "Create a draft outbound campaign from immutable configuration versions.",
  conversation_set_automation: "Set a campaign conversation to Setter IA, human or disabled mode.",
  content_autopilot_configure: "Configure the durable LinkedIn content autopilot schedule.",
  knowledge_source_create: "Create a knowledge source or proof without validating it.",
  knowledge_source_validate: "Validate a knowledge source so agents may use it as evidence.",
  knowledge_claim_create: "Create a sourced product claim without validating it.",
  knowledge_claim_validate: "Validate a sourced claim so agents may use it.",
};

export function registerMcpWriteTools(server: McpServer, capabilities: McpWriteCapabilities, context: McpExecutionContext): void {
  for (const name of Object.keys(mcpWriteToolArgumentsSchema) as McpWriteToolName[]) {
    register(server, name, mcpWriteToolArgumentsSchema[name], capabilities, context);
  }
}

function register<Name extends McpWriteToolName>(server: McpServer, name: Name, inputSchema: StandardSchemaWithJSON, capabilities: McpWriteCapabilities, context: McpExecutionContext): void {
  server.registerTool(name, {
    description: TOOL_DESCRIPTIONS[name],
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (raw) => {
    if (!isMcpWriteRoleAllowed(context.role)) {
      await capabilities.recordAudit?.(context, name, "forbidden");
      return toolError("WRITE_FORBIDDEN");
    }
    if (!context.scopes.includes("mcp:write")) {
      await capabilities.recordAudit?.(context, name, "scope_denied");
      return toolError("WRITE_SCOPE_REQUIRED");
    }
    try {
      const args = parseMcpWriteArguments(name, raw) as McpWriteArguments[Name];
      const result = await capabilities.execute(context, { operation: name, requestKey: args.requestKey, inputHash: canonicalMcpWriteHash(args), arguments: args });
      return toolResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = STABLE_WRITE_ERRORS.has(message) || STABLE_DOMAIN_ERROR.test(message) ? message : "WRITE_FAILED";
      if (code === "WRITE_FAILED") await capabilities.recordAudit?.(context, name, "rejected");
      return toolError(code);
    }
  });
}

function toolResult(value: McpWriteResult) {
  const bounded = {
    id: value.id,
    version: value.version,
    state: value.state,
    ...(value.status ? { status: value.status } : {}),
    operation: value.operation,
    correlationId: value.correlationId,
    ...(value.operationId ? { operationId: value.operationId } : {}),
    ...(value.jobId ? { jobId: value.jobId } : {}),
    ...(value.operationUri ? { operationUri: value.operationUri } : {}),
    ...(value.auditId ? { auditId: value.auditId } : {}),
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(bounded) }], structuredContent: bounded };
}

function toolError(code: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: code }) }], structuredContent: { error: code } };
}
