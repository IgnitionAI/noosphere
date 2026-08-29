import { createHash } from "node:crypto";
import { z } from "zod/v4";

export const MCP_WRITE_TOOL_NAMES = [
  "company_upsert",
  "contact_upsert",
  "opportunity_update",
  "opportunity_change_stage",
  "prospect_add_note",
  "content_idea_create",
  "content_draft_create",
  "prospect_schedule_dry_run",
] as const;

export type McpWriteToolName = (typeof MCP_WRITE_TOOL_NAMES)[number];
export type McpWriteRole = "viewer" | "operator" | "reviewer" | "admin" | "owner";

const uuid = z.string().uuid();
const requestKey = z.object({ requestKey: uuid, expectedVersion: z.coerce.number().int().min(0).optional() }).strict();
const shortText = z.string().trim().min(1).max(2_000);
const entityId = z.object({ id: uuid }).strict();

export const mcpWriteToolArgumentsSchema = {
  company_upsert: requestKey.extend({
    id: uuid.optional(), name: shortText, domain: z.string().trim().max(600).nullish(), sector: z.string().trim().max(200).nullish(),
    location: z.string().trim().max(300).nullish(), employeeCountMin: z.coerce.number().int().min(0).max(1_000_000).nullish(), employeeCountMax: z.coerce.number().int().min(0).max(1_000_000).nullish(),
  }).strict(),
  contact_upsert: requestKey.extend({
    id: uuid.optional(), firstName: shortText, lastName: shortText, companyId: uuid.nullish(), title: shortText.max(300).nullish(), email: z.string().email().max(320).nullish(), phone: z.string().trim().max(64).nullish(),
  }).strict(),
  opportunity_update: requestKey.extend({
    opportunityId: uuid, amount: z.coerce.number().finite().min(0).max(1_000_000_000).nullish(), currency: z.string().regex(/^[A-Z]{3}$/).nullish(), probability: z.coerce.number().int().min(0).max(100).nullish(), nextAction: z.string().trim().max(2_000).nullish(),
  }).strict(),
  opportunity_change_stage: requestKey.extend({ opportunityId: uuid, stage: z.enum(["new", "qualified", "meeting_booked", "won", "lost"]), reason: z.string().trim().max(2_000).nullish() }).strict(),
  prospect_add_note: requestKey.extend({ contactId: uuid, note: shortText.max(10_000) }).strict(),
  content_idea_create: requestKey.extend({ title: shortText.max(300), brief: shortText.max(10_000), strategyId: uuid.nullish() }).strict(),
  content_draft_create: requestKey.extend({ ideaId: uuid, body: shortText.max(100_000), format: z.enum(["linkedin_text", "linkedin_image", "linkedin_document", "linkedin_video"]).default("linkedin_text") }).strict(),
  prospect_schedule_dry_run: requestKey.extend({ contactId: uuid, campaignId: uuid.nullish(), scheduledFor: z.string().datetime({ offset: true }).nullish() }).strict(),
} as const;

export type McpWriteArguments = {
  [Name in McpWriteToolName]: z.output<(typeof mcpWriteToolArgumentsSchema)[Name]>;
};

export function parseMcpWriteArguments<Name extends McpWriteToolName>(name: Name, value: unknown): McpWriteArguments[Name] {
  return mcpWriteToolArgumentsSchema[name].parse(value ?? {}) as McpWriteArguments[Name];
}

export function isMcpWriteRoleAllowed(role: McpWriteRole): boolean {
  return role === "operator" || role === "admin" || role === "owner";
}

/** Stable hash over recursively sorted JSON, excluding no fields. */
export function canonicalMcpWriteHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
