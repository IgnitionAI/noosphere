import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { McpExecutionContext, McpWriteCapabilities, McpWriteResult } from "@outbound/application/mcp/mcp-write-capabilities";
import { canonicalMcpWriteHash, isMcpWriteRoleAllowed, mcpWriteToolArgumentsSchema, parseMcpWriteArguments, type McpWriteArguments, type McpWriteToolName } from "@outbound/interface/mcp/mcp-write-contracts";

const STABLE_WRITE_ERRORS = new Set(["MCP_WRITE_IDEMPOTENCY_CONFLICT", "MCP_WRITE_VERSION_CONFLICT", "MCP_WRITE_IN_PROGRESS", "MCP_WRITE_RECOVERY_REQUIRED", "WRITE_NOT_FOUND", "WRITE_FORBIDDEN", "WRITE_SCOPE_REQUIRED", "WRITE_RATE_LIMITED"]);

export function registerMcpWriteTools(server: McpServer, capabilities: McpWriteCapabilities, context: McpExecutionContext): void {
  for (const name of Object.keys(mcpWriteToolArgumentsSchema) as McpWriteToolName[]) {
    register(server, name, mcpWriteToolArgumentsSchema[name], capabilities, context);
  }
}

function register<Name extends McpWriteToolName>(server: McpServer, name: Name, inputSchema: StandardSchemaWithJSON, capabilities: McpWriteCapabilities, context: McpExecutionContext): void {
  server.registerTool(name, { description: `Internal ${name} mutation (no external side effect).`, inputSchema }, async (raw) => {
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
      const code = error instanceof Error && STABLE_WRITE_ERRORS.has(error.message) ? error.message : "WRITE_FAILED";
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
