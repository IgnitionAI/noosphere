import { z } from "zod/v4";
import { MCP_GOVERNED_EFFECT_KINDS } from "@outbound/application/mcp/mcp-governed-effects";
export { MCP_GOVERNED_EFFECT_KINDS } from "@outbound/application/mcp/mcp-governed-effects";

export const MCP_GOVERNED_EFFECT_TOOL_NAMES = [
  "conversation_prepare_reply",
  "content_prepare_publication",
  "meeting_prepare_proposal",
  "campaign_prepare_activation",
  "approval_list",
  "approval_get",
  "approval_decide",
] as const;

export type McpGovernedEffectToolName = (typeof MCP_GOVERNED_EFFECT_TOOL_NAMES)[number];

const uuid = z.string().uuid();
const request = z.object({
  requestKey: uuid,
  expectedVersion: z.coerce.number().int().min(0).optional(),
}).strict();
const boundedBody = z.string().trim().min(1).max(10_000);
const boundedJustification = z.string().trim().min(1).max(2_000);

export const mcpGovernedEffectToolArgumentsSchema = {
  conversation_prepare_reply: request.extend({
    conversationId: uuid,
    body: boundedBody,
  }).strict(),
  content_prepare_publication: request.extend({
    assetId: uuid,
    assetVersionId: uuid.optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  meeting_prepare_proposal: request.extend({
    meetingProposalId: uuid,
    slotPosition: z.coerce.number().int().min(1).max(20),
  }).strict(),
  campaign_prepare_activation: request.extend({
    campaignId: uuid,
  }).strict(),
  approval_list: z.object({
    status: z.enum([
      "approval_required",
      "policy_denied",
      "queued",
      "accepted",
      "unknown",
      "reconciling",
      "delivered",
      "failed",
      "rejected",
      "invalidated",
    ]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).strict(),
  approval_get: z.object({
    proposalId: uuid.optional(),
    approvalItemId: uuid.optional(),
  }).strict().refine((value) => (value.proposalId !== undefined) !== (value.approvalItemId !== undefined), {
    message: "exactly one of proposalId or approvalItemId is required",
  }),
  approval_decide: z.object({
    approvalItemId: uuid,
    decision: z.enum(["approve", "reject"]),
    justification: boundedJustification.optional(),
  }).strict().superRefine((value, context) => {
    if (value.decision === "reject" && value.justification === undefined) {
      context.addIssue({ code: "custom", path: ["justification"], message: "justification is required when rejecting" });
    }
  }),
} as const;

export type McpGovernedEffectToolArguments = {
  [Name in McpGovernedEffectToolName]: z.output<(typeof mcpGovernedEffectToolArgumentsSchema)[Name]>;
};

export function parseMcpGovernedEffectArguments<Name extends McpGovernedEffectToolName>(
  name: Name,
  value: unknown,
): McpGovernedEffectToolArguments[Name] {
  const schema = mcpGovernedEffectToolArgumentsSchema[name];
  if (!schema) throw new Error("MCP_GOVERNED_EFFECT_TOOL_UNKNOWN");
  return schema.parse(value ?? {}) as McpGovernedEffectToolArguments[Name];
}

export type McpGovernedEffectKind = (typeof MCP_GOVERNED_EFFECT_KINDS)[number];

export const mcpGovernedEffectArgumentsSchema = mcpGovernedEffectToolArgumentsSchema;
export const parseMcpGovernedEffectToolArguments = parseMcpGovernedEffectArguments;
