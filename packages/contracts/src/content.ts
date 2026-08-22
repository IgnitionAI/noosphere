import { z } from "zod";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";
import type { ContentIdeaCandidate } from "@outbound/domain/content/content-idea";
import type {
  ContentBriefSnapshot,
  ContentDraftSnapshot,
  ContentEditorialCritique,
  ContentEvidenceAudit,
} from "@outbound/domain/content/content-asset";

export const editorialStrategySnapshotSchema: z.ZodType<EditorialStrategySnapshot> = z.object({
  audience: z.object({
    name: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(2_000),
    awareness: z.enum(["unaware", "problem_aware", "solution_aware", "product_aware", "mixed"]),
  }).strict(),
  pillars: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    promise: z.string().trim().min(1).max(1_000),
    proofTypes: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
  }).strict()).min(3).max(6),
  voice: z.object({
    traits: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
    avoid: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
  }).strict(),
  formats: z.array(z.enum(["linkedin_text", "linkedin_document", "linkedin_image", "linkedin_video"])).min(1).max(4),
  cadence: z.object({
    postsPerWeek: z.number().int().min(1).max(7),
    preferredDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    timezone: z.string().trim().min(1).max(120),
  }).strict(),
  callsToAction: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  allowedClaimIds: z.array(z.string().uuid()).max(100),
  forbiddenTopics: z.array(z.string().trim().min(1).max(300)).max(30),
}).strict();

export const contentIdeaCandidateSchema: z.ZodType<ContentIdeaCandidate> = z.object({
  angle: z.string().trim().min(10).max(500),
  rationale: z.string().trim().min(10).max(2_000),
  audience: z.string().trim().min(2).max(500),
  pillar: z.string().trim().min(2).max(300),
  priority: z.number().int().min(0).max(100),
  freshnessDays: z.number().int().min(1).max(365),
  sourceKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  conceptKey: z.string().trim().min(3).max(500),
}).strict();

export const contentIdeaBatchSchema = z.object({
  ideas: z.array(contentIdeaCandidateSchema).max(12),
}).strict();

export const contentIdeaDiscoveryRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
}).strict();

export const contentBriefSnapshotSchema: z.ZodType<ContentBriefSnapshot> = z.object({
  objective: z.enum(["educate", "challenge", "explain", "prove"]),
  audience: z.string().trim().min(2).max(500),
  problem: z.string().trim().min(10).max(2_000),
  angle: z.string().trim().min(10).max(500),
  format: z.literal("linkedin_text"),
  evidenceKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  allowedClaimIds: z.array(z.string().uuid()).max(100),
  callToAction: z.string().trim().min(2).max(300).nullable(),
  constraints: z.array(z.string().trim().min(2).max(500)).min(1).max(20),
}).strict();

export const contentDraftSnapshotSchema: z.ZodType<ContentDraftSnapshot> = z.object({
  hook: z.string().trim().min(5).max(500),
  body: z.string().trim().min(80).max(3_000),
  callToAction: z.string().trim().min(2).max(300).nullable(),
  factualClaims: z.array(z.object({
    statement: z.string().trim().min(3).max(1_000),
    sourceKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  }).strict()).max(20),
  opinionStatements: z.array(z.string().trim().min(3).max(1_000)).max(20),
}).strict();

export const contentEvidenceAuditSchema: z.ZodType<ContentEvidenceAudit> = z.object({
  reviewedClaims: z.array(z.object({
    statement: z.string().trim().min(3).max(1_000),
    sourceKeys: z.array(z.string().trim().min(1).max(500)).max(12),
    verdict: z.enum(["supported", "unsupported"]),
    reason: z.string().trim().min(3).max(1_000),
  }).strict()).max(30),
  ungroundedStatements: z.array(z.string().trim().min(3).max(1_000)).max(20),
  forbiddenTopicMatches: z.array(z.string().trim().min(2).max(500)).max(20),
}).strict();

export const contentEditorialCritiqueSchema: z.ZodType<ContentEditorialCritique> = z.object({
  genericPhrases: z.array(z.string().trim().min(2).max(500)).max(20),
  repeatedConcepts: z.array(z.string().trim().min(2).max(500)).max(20),
  callToActionAligned: z.boolean(),
  distinctFromHistory: z.boolean(),
  issues: z.array(z.object({
    severity: z.enum(["advice", "blocker"]),
    code: z.string().trim().min(2).max(120),
    message: z.string().trim().min(3).max(1_000),
  }).strict()).max(20),
  summary: z.string().trim().min(3).max(1_500),
}).strict();

export const contentGenerationRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
  instruction: z.string().trim().min(3).max(1_500).optional(),
}).strict();

export const contentPublicationScheduleRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
  scheduledFor: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
}).strict();

export const contentPublicationMutationRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
}).strict();

export const contentAutopilotConfigureRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
  enabled: z.boolean(),
  localTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/),
  timezone: z.string().trim().min(1).max(120).refine((value) => {
    try {
      new Intl.DateTimeFormat("fr-FR", { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone"),
  publicationTimes: z.array(z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/))
    .min(1)
    .max(2)
    .refine((values) => new Set(values).size === values.length, "Publication times must be unique")
    .optional(),
  publicationDays: z.array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((values) => new Set(values).size === values.length, "Publication days must be unique")
    .optional(),
}).strict();
