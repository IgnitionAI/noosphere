import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { McpExecutionContext, McpReadCapabilities } from "@outbound/application/mcp/mcp-read-capabilities";
import { redactMcpOperationValue, redactMcpReadValue } from "@outbound/interface/mcp/mcp-read-contracts";

/** Register the issue #73 stable resources/templates on a fresh SDK server. */
export function registerMcpReadResources(
  server: McpServer,
  capabilities: McpReadCapabilities,
  context: McpExecutionContext,
): void {
  server.registerResource("workspace_summary", "noosphere://workspace/current/summary", {
    description: "Current workspace operational summary.", mimeType: "application/json",
  }, async (uri) => jsonResource(uri.href, await capabilities.workspace.getSummary(context, { limit: 25 }), context.role));
  server.registerResource("workspace_pipeline", "noosphere://workspace/current/pipeline", {
    description: "Current workspace pipeline.", mimeType: "application/json",
  }, async (uri) => jsonResource(uri.href, await capabilities.pipeline.list(context, { limit: 25 }), context.role));
  server.registerResource("content_calendar", "noosphere://content/calendar", {
    description: "Bounded content calendar.", mimeType: "application/json",
  }, async (uri) => jsonResource(uri.href, await capabilities.content.getCalendar(context, { limit: 25 }), context.role));
  server.registerResource("operations_health", "noosphere://operations/health", {
    description: "Workspace-safe operational health.", mimeType: "application/json",
  }, async (uri) => jsonResource(uri.href, await capabilities.operations.getHealth(context), context.role));
  server.registerResource("operation", new ResourceTemplate("noosphere://operations/{operationId}", { list: undefined }), {
    description: "Read a durable MCP operation status.", mimeType: "application/json",
  }, async (uri, variables) => {
    const operationId = uuidVariable(variables.operationId);
    const operation = await capabilities.operations.get(context, { operationId });
    return operation === null
      ? errorResource(uri.href, "NOT_FOUND")
      : jsonResource(uri.href, redactMcpOperationValue(operation), context.role);
  });

  server.registerResource("company_brief", new ResourceTemplate("noosphere://companies/{companyId}/brief", { list: undefined }), {
    description: "Redacted company brief.", mimeType: "application/json",
  }, async (uri, variables) => {
    const companyId = uuidVariable(variables.companyId);
    return jsonResource(uri.href, await capabilities.crm.getCompany(context, { companyId }), context.role);
  });
  server.registerResource("prospect_360", new ResourceTemplate("noosphere://prospects/{contactId}/360", { list: undefined }), {
    description: "Semantic Prospect 360 projection.", mimeType: "application/json",
  }, async (uri, variables) => {
    const contactId = uuidVariable(variables.contactId);
    return jsonResource(uri.href, await capabilities.prospect.get360(context, { contactId }), context.role);
  });
  server.registerResource("opportunity", new ResourceTemplate("noosphere://opportunities/{opportunityId}", { list: undefined }), {
    description: "Pipeline opportunity.", mimeType: "application/json",
  }, async (uri, variables) => {
    const opportunityId = uuidVariable(variables.opportunityId);
    return jsonResource(uri.href, await capabilities.opportunity.get(context, { opportunityId }), context.role);
  });
  server.registerResource("campaign_status", new ResourceTemplate("noosphere://campaigns/{campaignId}/status", { list: undefined }), {
    description: "Campaign automation status.", mimeType: "application/json",
  }, async (uri, variables) => {
    const campaignId = uuidVariable(variables.campaignId);
    return jsonResource(uri.href, await capabilities.campaign.getStatus(context, { campaignId }), context.role);
  });
}

function jsonResource(uri: string, value: unknown, role: McpExecutionContext["role"]) {
  if (value === null) throw new Error("NOT_FOUND");
  const redacted = redactMcpReadValue(value, role);
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(normalize(redacted)) }],
  };
}

function errorResource(uri: string, error: string) {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error }) }] };
}

function uuidVariable(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
    throw new Error("INVALID_RESOURCE_URI");
  }
  return candidate;
}

function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
