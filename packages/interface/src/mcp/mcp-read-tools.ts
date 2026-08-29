import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { McpExecutionContext, McpReadCapabilities, McpReadValue } from "@outbound/application/mcp/mcp-read-capabilities";
import {
  mcpToolArgumentsSchema,
  parseMcpToolArguments,
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
  register(server, "workspace_get_summary", "Read the current workspace operational summary.", mcpToolArgumentsSchema.workspace_get_summary, context, async (args) => capabilities.workspace.getSummary(context, args));
  register(server, "crm_search", "Search companies and contacts in the current workspace.", mcpToolArgumentsSchema.crm_search, context, async (args) => capabilities.crm.search(context, args));
  register(server, "company_get_brief", "Read a redacted company brief.", mcpToolArgumentsSchema.company_get_brief, context, async (args) => capabilities.crm.getCompany(context, args));
  register(server, "prospect_get_360", "Read the semantic Prospect 360 projection.", mcpToolArgumentsSchema.prospect_get_360, context, async (args) => capabilities.prospect.get360(context, args));
  register(server, "pipeline_list", "List bounded pipeline opportunities.", mcpToolArgumentsSchema.pipeline_list, context, async (args) => capabilities.pipeline.list(context, args));
  register(server, "opportunity_get", "Read one pipeline opportunity.", mcpToolArgumentsSchema.opportunity_get, context, async (args) => capabilities.opportunity.get(context, args));
  register(server, "conversation_list", "List bounded workspace conversations.", mcpToolArgumentsSchema.conversation_list, context, async (args) => capabilities.conversation.list(context, args));
  register(server, "campaign_get_status", "Read campaign automation status.", mcpToolArgumentsSchema.campaign_get_status, context, async (args) => capabilities.campaign.getStatus(context, args));
  register(server, "content_get_calendar", "Read the bounded content calendar.", mcpToolArgumentsSchema.content_get_calendar, context, async (args) => capabilities.content.getCalendar(context, args));
  register(server, "operations_get_health", "Read workspace-safe operational health.", mcpToolArgumentsSchema.operations_get_health, context, async () => capabilities.operations.getHealth(context));
}

function register<Name extends McpReadToolName>(
  server: McpServer,
  name: Name,
  description: string,
  inputSchema: StandardSchemaWithJSON,
  context: McpExecutionContext,
  callback: (args: McpToolArguments[Name]) => Promise<McpReadValue | null>,
): void {
  server.registerTool(name, { description, inputSchema }, async (args) => {
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
