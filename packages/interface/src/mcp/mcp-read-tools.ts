import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { McpExecutionContext, McpReadCapabilities, McpReadValue } from "@outbound/application/mcp/mcp-read-capabilities";
import {
  mcpToolArgumentsSchema,
  parseMcpToolArguments,
  redactMcpOperationValue,
  redactMcpReadValue,
  type McpToolArguments,
  type McpReadToolName,
} from "@outbound/interface/mcp/mcp-read-contracts";

/** Register the issue #73 read tools on a fresh SDK server instance. */
export function registerMcpReadTools(
  server: McpServer,
  capabilities: McpReadCapabilities,
  context: McpExecutionContext,
): void {
  if (capabilities.workspace.getReadiness) register(server, "workspace_get_readiness", "Read setup prerequisites before preparing acquisition. Reuse existing product, offer and ICP; ask only for missing information.", mcpToolArgumentsSchema.workspace_get_readiness, context, async () => capabilities.workspace.getReadiness!(context));
  if (capabilities.content.getBrand) register(server, "brand_get", "Read the current brand and version before changing it with brand_update.", mcpToolArgumentsSchema.brand_get, context, async () => capabilities.content.getBrand!(context));
  if (capabilities.content.getStrategy) register(server, "content_strategy_get", "Read the editorial strategy draft, source versions and preparation status. No strategy is represented by strategy: null, not an error.", mcpToolArgumentsSchema.content_strategy_get, context, async () => capabilities.content.getStrategy!(context));
  register(server, "workspace_get_summary", "Read the current workspace operational summary.", mcpToolArgumentsSchema.workspace_get_summary, context, async (args) => capabilities.workspace.getSummary(context, args));
  register(server, "crm_search", "Search companies and contacts in the current workspace.", mcpToolArgumentsSchema.crm_search, context, async (args) => capabilities.crm.search(context, args));
  register(server, "company_get_brief", "Read a redacted company brief.", mcpToolArgumentsSchema.company_get_brief, context, async (args) => capabilities.crm.getCompany(context, args));
  register(server, "prospect_get_360", "Read the semantic Prospect 360 projection.", mcpToolArgumentsSchema.prospect_get_360, context, async (args) => capabilities.prospect.get360(context, args));
  register(server, "pipeline_list", "List bounded pipeline opportunities.", mcpToolArgumentsSchema.pipeline_list, context, async (args) => capabilities.pipeline.list(context, args));
  register(server, "opportunity_get", "Read one pipeline opportunity.", mcpToolArgumentsSchema.opportunity_get, context, async (args) => capabilities.opportunity.get(context, args));
  register(server, "conversation_list", "List bounded workspace conversations.", mcpToolArgumentsSchema.conversation_list, context, async (args) => capabilities.conversation.list(context, args));
  register(server, "conversation_get", "Read one complete conversation with messages, decisions and latest command.", mcpToolArgumentsSchema.conversation_get, context, async (args) => capabilities.conversation.get(context, args));
  if (capabilities.campaign.listPlans) register(server, "acquisition_plan_list", "List acquisition plans produced from ICP research. Use existing plans instead of creating duplicate campaigns.", mcpToolArgumentsSchema.acquisition_plan_list, context, args => capabilities.campaign.listPlans!(context, args));
  if (capabilities.campaign.getPlan) register(server, "acquisition_plan_get", "Read channel assessments, preparation errors and campaigns for an acquisition plan.", mcpToolArgumentsSchema.acquisition_plan_get, context, args => capabilities.campaign.getPlan!(context, args));
  register(server, "campaign_list", "List campaigns in the current workspace.", mcpToolArgumentsSchema.campaign_list, context, async (args) => capabilities.campaign.list(context, args));
  register(server, "campaign_get_status", "Read campaign automation status.", mcpToolArgumentsSchema.campaign_get_status, context, async (args) => capabilities.campaign.getStatus(context, args));
  register(server, "offer_list", "List product offers and their current state.", mcpToolArgumentsSchema.offer_list, context, async (args) => capabilities.offer.list(context, args));
  register(server, "offer_get", "Read an offer and its immutable published versions.", mcpToolArgumentsSchema.offer_get, context, async (args) => capabilities.offer.get(context, args));
  register(server, "research_list", "List ICP product research runs.", mcpToolArgumentsSchema.research_list, context, async (args) => capabilities.research.list(context, args));
  register(server, "research_get", "Read one durable ICP research run.", mcpToolArgumentsSchema.research_get, context, async (args) => capabilities.research.get(context, args));
  register(server, "call_list", "List calls and calendar bookings.", mcpToolArgumentsSchema.call_list, context, async (args) => capabilities.calls.list(context, args));
  register(server, "knowledge_source_list", "List workspace knowledge sources.", mcpToolArgumentsSchema.knowledge_source_list, context, async (args) => capabilities.knowledge.listSources(context, args));
  register(server, "knowledge_claim_list", "List sourced workspace claims.", mcpToolArgumentsSchema.knowledge_claim_list, context, async (args) => capabilities.knowledge.listClaims(context, args));
  register(server, "content_get_calendar", "Read the bounded content calendar.", mcpToolArgumentsSchema.content_get_calendar, context, async (args) => capabilities.content.getCalendar(context, args));
  register(server, "content_autopilot_get", "Read the LinkedIn content autopilot configuration.", mcpToolArgumentsSchema.content_autopilot_get, context, async () => capabilities.content.getAutopilot(context));
  register(server, "operations_get_health", "Read workspace-safe operational health.", mcpToolArgumentsSchema.operations_get_health, context, async () => capabilities.operations.getHealth(context));
  register(server, "operation_get", "Read a durable MCP operation status.", mcpToolArgumentsSchema.operation_get, context, async (args) => redactMcpOperationValue(await capabilities.operations.get(context, args)) as McpReadValue | null);
}

function register<Name extends McpReadToolName>(
  server: McpServer,
  name: Name,
  description: string,
  inputSchema: StandardSchemaWithJSON,
  context: McpExecutionContext,
  callback: (args: McpToolArguments[Name]) => Promise<McpReadValue | null>,
): void {
  server.registerTool(name, {
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const parsed = parseMcpToolArguments(name, args);
      const value = await callback(parsed);
      if (value === null) return toolError("NOT_FOUND");
      return toolResult(redactMcpReadValue(value, context.role));
    } catch {
      return toolError("READ_FAILED");
    }
  });
}

function toolResult(value: unknown) {
  const normalized = normalize(value);
  const structuredContent = isObject(normalized) ? normalized : { data: normalized };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function toolError(code: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: code }) }],
    structuredContent: { error: code },
  };
}

function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
