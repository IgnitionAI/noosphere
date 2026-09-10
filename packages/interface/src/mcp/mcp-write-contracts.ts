import { editorialStrategySnapshotSchema } from "@outbound/contracts/content";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { productResearchBriefSchema } from "@outbound/contracts/product-research";

export const MCP_WRITE_TOOL_NAMES = [
  "content_strategy_update",
  "content_strategy_publish",
  "content_strategy_prepare",
  "brand_update",
  "company_upsert",
  "contact_upsert",
  "opportunity_update",
  "opportunity_change_stage",
  "prospect_add_note",
  "content_idea_create",
  "content_draft_create",
  "prospect_schedule_dry_run",
  "offer_create",
  "offer_update",
  "offer_publish",
  "research_launch",
  "campaign_create",
  "campaign_update",
  "conversation_set_automation",
  "content_autopilot_configure",
  "knowledge_source_create",
  "knowledge_source_validate",
  "knowledge_claim_create",
  "knowledge_claim_validate",
] as const;

export type McpWriteToolName = (typeof MCP_WRITE_TOOL_NAMES)[number];
export type McpWriteRole = "viewer" | "operator" | "reviewer" | "admin" | "owner";

const uuid = z.string().uuid();
const requestKey = z.object({ requestKey: uuid, expectedVersion: z.coerce.number().int().min(0).optional() }).strict();
const shortText = z.string().trim().min(1).max(2_000);
const entityId = z.object({ id: uuid }).strict();
const offerClaim = z.object({
  claim: z.string().trim().min(1).max(5_000),
  validationStatus: z.enum(["hypothesis", "sourced", "validated", "invalidated"]),
  evidenceUri: z.string().trim().max(2_000).nullish(),
}).strict();

export const mcpWriteToolArgumentsSchema = {
  content_strategy_update: z.object({ requestKey: uuid, strategyId: uuid, expectedUpdatedAt: z.string().datetime({ offset: true }), snapshot: editorialStrategySnapshotSchema }).strict(),
  content_strategy_publish: z.object({ requestKey: uuid, strategyId: uuid, expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict(),
  content_strategy_prepare: z.object({ requestKey: uuid, sources: z.object({ offerVersionId: uuid, icpVersionId: uuid }).strict().optional() }).strict(),
  brand_update: z.object({ requestKey: uuid, expectedVersion: z.number().int().min(0), patch: z.object({
    brandName: z.string().trim().min(2).max(120).optional(),
    tagline: z.string().trim().min(2).max(180).nullable().optional(),
    websiteUrl: z.string().trim().url().max(500).nullable().optional(),
    brandDescription: z.string().trim().min(1).max(2000).nullable().optional(),
    typography: z.enum(["inter", "space_grotesk", "system"]).optional(),
    imageStyle: z.enum(["editorial", "technical", "bold", "minimal"]).optional(),
    voice: z.object({ traits: z.array(z.string().trim().min(1).max(120)).max(8), avoid: z.array(z.string().trim().min(1).max(240)).max(12), preferredVocabulary: z.array(z.string().trim().min(1).max(120)).max(20) }).strict().optional(),
  }).strict().refine(value => Object.keys(value).length > 0, "Provide at least one brand field") }).strict(),
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
  offer_create: requestKey.extend({ name: z.string().trim().min(1).max(500), category: z.enum(["service", "saas", "licence", "autre"]).default("autre"), targetAudience: z.string().max(5_000).default("") }).strict(),
  offer_update: requestKey.extend({
    offerId: uuid, name: z.string().trim().min(1).max(500).optional(), category: z.enum(["service", "saas", "licence", "autre"]).optional(),
    valueProposition: z.string().max(10_000).optional(), targetAudience: z.string().max(5_000).optional(), pricing: z.unknown().optional(),
    commercialRules: z.unknown().optional(), constraints: z.unknown().optional(), claims: z.array(offerClaim).max(100).optional(), objections: z.unknown().optional(),
  }).strict().refine((value) => ["name", "category", "valueProposition", "targetAudience", "pricing", "commercialRules", "constraints", "claims", "objections"].some((key) => key in value), { message: "at least one offer field is required" }),
  offer_publish: requestKey.extend({ offerId: uuid }).strict(),
  research_launch: requestKey.extend({ brief: productResearchBriefSchema }).strict(),
  campaign_update: z.object({ requestKey: uuid, campaignId: uuid, expectedUpdatedAt: z.string().datetime({ offset: true }),
    name: z.string().trim().min(1).max(300).optional(), objective: z.string().max(10000).optional(),
    offerVersionId: uuid.optional(), icpVersionId: uuid.optional(), messagingStrategyVersionId: uuid.optional(), aiPolicyVersionId: uuid.optional(), sequenceVersionId: uuid.optional(),
  }).strict().refine(value => ["name", "objective", "offerVersionId", "icpVersionId", "messagingStrategyVersionId", "aiPolicyVersionId", "sequenceVersionId"].some(key => key in value), "Provide a campaign field"),
  campaign_create: requestKey.extend({
    name: z.string().trim().min(1).max(300), objective: z.string().max(10_000).default(""), offerVersionId: uuid, icpVersionId: uuid,
    messagingStrategyVersionId: uuid, aiPolicyVersionId: uuid, sequenceVersionId: uuid,
  }).strict(),
  conversation_set_automation: requestKey.extend({ conversationId: uuid, mode: z.enum(["setter", "human", "disabled"]) }).strict(),
  content_autopilot_configure: requestKey.extend({
    enabled: z.boolean(), localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().trim().min(1).max(120),
    publicationTimes: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(14).optional(),
    publicationDays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).optional(),
  }).strict(),
  knowledge_source_create: requestKey.extend({
    type: z.enum(["product_document", "proof", "customer_case", "objection_response"]), title: z.string().trim().min(1).max(500),
    content: z.string().trim().min(1).max(200_000).nullish(), researchDocumentId: uuid.nullish(), authorName: z.string().trim().min(1).max(300),
    publishedAt: z.string().datetime({ offset: true }), freshnessUntil: z.string().datetime({ offset: true }).nullish(),
  }).strict().refine((value) => Boolean(value.content || value.researchDocumentId), { message: "content or researchDocumentId is required" }),
  knowledge_source_validate: requestKey.extend({ sourceId: uuid }).strict(),
  knowledge_claim_create: requestKey.extend({ claim: z.string().trim().min(1).max(5_000), offerClaimId: uuid.nullish(), sourceIds: z.array(uuid).max(50).default([]) }).strict(),
  knowledge_claim_validate: requestKey.extend({ claimId: uuid }).strict(),
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
