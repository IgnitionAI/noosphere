import { z } from "zod/v4";

export const MCP_READ_RESOURCE_URIS = [
  "noosphere://workspace/current/summary",
  "noosphere://workspace/current/pipeline",
  "noosphere://companies/{companyId}/brief",
  "noosphere://prospects/{contactId}/360",
  "noosphere://opportunities/{opportunityId}",
  "noosphere://campaigns/{campaignId}/status",
  "noosphere://content/calendar",
  "noosphere://operations/health",
] as const;

export const MCP_READ_TOOL_NAMES = [
  "workspace_get_summary",
  "crm_search",
  "company_get_brief",
  "prospect_get_360",
  "pipeline_list",
  "opportunity_get",
  "conversation_list",
  "campaign_get_status",
  "content_get_calendar",
  "operations_get_health",
] as const;

export type McpReadToolName = (typeof MCP_READ_TOOL_NAMES)[number];
export type McpReadRole = "viewer" | "operator" | "reviewer" | "admin" | "owner";

const uuid = z.string().uuid();
const pagination = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const mcpToolArgumentsSchema = {
  workspace_get_summary: pagination,
  crm_search: pagination.extend({
    query: z.string().trim().min(1).max(200).optional(),
    entity: z.enum(["company", "contact"]).optional(),
  }),
  company_get_brief: z.object({ companyId: uuid }).strict(),
  prospect_get_360: z.object({ contactId: uuid }).strict(),
  pipeline_list: pagination,
  opportunity_get: z.object({ opportunityId: uuid }).strict(),
  conversation_list: pagination.extend({
    channel: z.enum(["linkedin", "email", "whatsapp"]).optional(),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(100).optional(),
  }),
  campaign_get_status: z.object({ campaignId: uuid }).strict(),
  content_get_calendar: pagination.extend({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  }),
  operations_get_health: z.object({}).strict(),
} as const;

export type McpToolArguments = {
  [Name in McpReadToolName]: z.output<(typeof mcpToolArgumentsSchema)[Name]>;
};

export function parseMcpToolArguments<Name extends McpReadToolName>(name: Name, value: unknown): McpToolArguments[Name] {
  return mcpToolArgumentsSchema[name].parse(value ?? {}) as McpToolArguments[Name];
}

const alwaysRedactedKeys = new Set([
  "accessToken",
  "authorization",
  "credential",
  "credentials",
  "password",
  "providerAccountId",
  "providerMessageId",
  "providerPostId",
  "providerSocialId",
  "rawAuthorization",
  "refreshToken",
  "secret",
  "token",
]);
const viewerRedactedKeys = new Set(["amount", "currency", "sensitive", "email", "phone", "provider", "providerUrl"]);

/** Remove secrets/provider material and role-sensitive fields from JSON output. */
export function redactMcpReadValue(value: unknown, role: McpReadRole): unknown {
  if (Array.isArray(value)) return value.map((item) => redactMcpReadValue(item, role));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (alwaysRedactedKeys.has(key) || (role === "viewer" && viewerRedactedKeys.has(key))) continue;
    output[key] = redactMcpReadValue(child, role);
  }
  return output;
}
