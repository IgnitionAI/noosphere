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
  "noosphere://operations/{operationId}",
] as const;

export const MCP_READ_TOOL_NAMES = [
  "workspace_get_summary",
  "workspace_get_readiness",
  "brand_get",
  "content_strategy_get",
  "crm_search",
  "company_get_brief",
  "prospect_get_360",
  "pipeline_list",
  "opportunity_get",
  "conversation_list",
  "conversation_get",
  "acquisition_plan_list",
  "acquisition_plan_get",
  "campaign_list",
  "campaign_get_status",
  "offer_list",
  "offer_get",
  "research_list",
  "research_get",
  "call_list",
  "knowledge_source_list",
  "knowledge_claim_list",
  "content_get_calendar",
  "content_autopilot_get",
  "operations_get_health",
  "operation_get",
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
  workspace_get_readiness: z.object({}).strict(),
  brand_get: z.object({}).strict(),
  content_strategy_get: z.object({}).strict(),
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
  conversation_get: z.object({ conversationId: uuid }).strict(),
  acquisition_plan_list: pagination,
  acquisition_plan_get: z.object({ planId: uuid }).strict(),
  campaign_list: pagination,
  campaign_get_status: z.object({ campaignId: uuid }).strict(),
  offer_list: pagination,
  offer_get: z.object({ offerId: uuid }).strict(),
  research_list: pagination,
  research_get: z.object({ runId: uuid }).strict(),
  call_list: pagination.extend({ contactId: uuid.optional(), opportunityId: uuid.optional() }),
  knowledge_source_list: pagination.extend({
    type: z.enum(["product_document", "proof", "customer_case", "objection_response"]).optional(),
    status: z.enum(["draft", "validated", "expired", "withdrawn"]).optional(),
  }),
  knowledge_claim_list: pagination,
  content_get_calendar: pagination.extend({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  }),
  content_autopilot_get: z.object({}).strict(),
  operations_get_health: z.object({}).strict(),
  operation_get: z.object({ operationId: uuid }).strict(),
} as const;

export type McpToolArguments = {
  [Name in McpReadToolName]: z.output<(typeof mcpToolArgumentsSchema)[Name]>;
};

export function parseMcpToolArguments<Name extends McpReadToolName>(name: Name, value: unknown): McpToolArguments[Name] {
  return mcpToolArgumentsSchema[name].parse(value ?? {}) as McpToolArguments[Name];
}

/** Enforce the operation public projection at the transport boundary too.
 * Capabilities are injected, so never serialize an arbitrary implementation
 * object even when it is structurally assignable to the public type. */
export function redactMcpOperationValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const statuses = new Set(["queued", "running", "completed", "failed", "cancelled"]);
  if (typeof input.operationId !== "string" || typeof input.jobId !== "string"
    || typeof input.correlationId !== "string" || typeof input.status !== "string"
    || !statuses.has(input.status) || typeof input.createdAt !== "string"
    || typeof input.updatedAt !== "string" || typeof input.operationUri !== "string") return null;
  const refs = Array.isArray(input.resultRefs) ? input.resultRefs.slice(0, 20).flatMap((ref) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return [];
    const candidate = ref as Record<string, unknown>;
    return typeof candidate.type === "string" && candidate.type.length > 0 && candidate.type.length <= 120
      && typeof candidate.id === "string" && candidate.id.length > 0 && candidate.id.length <= 120
      ? [{ type: candidate.type, id: candidate.id }] : [];
  }) : [];
  const errorCode = typeof input.errorCode === "string" && /^[A-Z][A-Z0-9_.-]{0,119}$/.test(input.errorCode)
    ? input.errorCode : null;
  return {
    operationId: input.operationId,
    jobId: input.jobId,
    correlationId: input.correlationId,
    status: input.status,
    resultRefs: refs,
    errorCode,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    operationUri: `noosphere://operations/${input.operationId}`,
  };
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
