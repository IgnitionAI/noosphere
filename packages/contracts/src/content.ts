import { z } from "zod";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";
import type { ContentIdeaCandidate } from "@outbound/domain/content/content-idea";
import type {
  ContentBriefSnapshot,
  ContentDraftSnapshot,
  ContentEditorialCritique,
  ContentEvidenceAudit,
} from "@outbound/domain/content/content-asset";
import type { ContentBrandKitSnapshot } from "@outbound/domain/content/content-brand-kit";
import { linkedinContentFormats } from "@outbound/domain/content/content-brand-kit";

const linkedinContentFormatSchema = z.enum(linkedinContentFormats);

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
  formats: z.array(linkedinContentFormatSchema).min(1).max(4),
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
  format: linkedinContentFormatSchema,
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
  mediaPlan: z.object({
    format: linkedinContentFormatSchema,
    visualTone: z.enum(["editorial", "technical", "bold", "minimal"]),
    title: z.string().trim().min(3).max(180).nullable(),
    subtitle: z.string().trim().min(3).max(280).nullable(),
    altText: z.string().trim().min(3).max(500).nullable(),
    slides: z.array(z.object({
      title: z.string().trim().min(2).max(140),
      body: z.string().trim().min(3).max(500),
      layout: z.enum(["auto", "cover", "insight", "checklist", "framework", "comparison", "process", "closing"]).optional().default("auto"),
      kicker: z.string().trim().min(2).max(80).nullable().optional().default(null),
      callout: z.string().trim().min(2).max(240).nullable().optional().default(null),
      items: z.array(z.object({
        label: z.string().trim().min(1).max(80),
        text: z.string().trim().min(2).max(220),
      }).strict()).max(4).optional().default([]),
    }).strict()).max(9),
    scenes: z.array(z.object({
      title: z.string().trim().min(2).max(140),
      body: z.string().trim().min(3).max(500),
      durationSeconds: z.number().int().min(3).max(15),
    }).strict()).max(8),
  }).strict().optional().default({
    format: "linkedin_text",
    visualTone: "editorial",
    title: null,
    subtitle: null,
    altText: null,
    slides: [],
    scenes: [],
  }),
}).strict();

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const contentBrandKitSnapshotSchema: z.ZodType<ContentBrandKitSnapshot> = z.object({
  brandName: z.string().trim().min(2).max(120),
  tagline: z.string().trim().min(2).max(180).nullable(),
  websiteUrl: z.string().trim().url().max(500).nullable().optional().default(null),
  brandDescription: z.string().trim().min(1).max(2_000).nullable().optional().default(null),
  logo: z.object({
    objectKey: z.string().trim().min(1).max(1_000),
    mimeType: z.literal("image/png"),
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().min(1).max(4_096),
    height: z.number().int().min(1).max(4_096),
    previewDataUrl: z.string().startsWith("data:image/png;base64,").max(250_000),
    sourceFileName: z.string().trim().min(1).max(255),
  }).strict().nullable().optional().default(null),
  colors: z.object({
    primary: hexColorSchema,
    accent: hexColorSchema,
    background: hexColorSchema,
    text: hexColorSchema,
  }).strict(),
  paletteMetadata: z.object({
    generatedBy: z.enum(["manual", "detected", "ai"]),
    sources: z.array(z.enum(["landing_page", "logo", "description", "manual"])).min(1).max(4)
      .refine((values) => new Set(values).size === values.length, "Palette sources must be unique"),
    rationale: z.string().trim().min(10).max(1_000).nullable(),
  }).strict().optional().default({ generatedBy: "manual", sources: ["manual"], rationale: null }),
  typography: z.enum(["inter", "space_grotesk", "system"]),
  enabledFormats: z.array(linkedinContentFormatSchema).min(1).max(4)
    .refine((values) => new Set(values).size === values.length, "Formats must be unique"),
  weeklyMix: z.object({
    linkedin_text: z.number().int().min(0).max(14),
    linkedin_image: z.number().int().min(0).max(14),
    linkedin_document: z.number().int().min(0).max(14),
    linkedin_video: z.number().int().min(0).max(14),
  }).strict(),
  imageStyle: z.enum(["editorial", "technical", "bold", "minimal"]),
  // Generative video stays behind the application port until a provider is
  // configured. Do not let API clients persist a mode the worker cannot run.
  videoMode: z.literal("motion_graphics"),
  voice: z.object({
    traits: z.array(z.string().trim().min(1).max(120)).max(8),
    avoid: z.array(z.string().trim().min(1).max(240)).max(12),
    preferredVocabulary: z.array(z.string().trim().min(1).max(120)).max(20),
  }).strict().optional().default({
    traits: ["clair", "direct", "expert sans jargon"],
    avoid: ["promesses vagues", "superlatifs", "ton robotique"],
    preferredVocabulary: [],
  }),
}).strict().superRefine((value, context) => {
  const enabled = new Set(value.enabledFormats);
  const total = linkedinContentFormats.reduce((sum, format) => sum + value.weeklyMix[format], 0);
  if (total < 1 || total > 14) context.addIssue({ code: "custom", message: "Weekly mix must total between 1 and 14" });
  for (const format of linkedinContentFormats) {
    if (enabled.has(format) && value.weeklyMix[format] < 1) context.addIssue({ code: "custom", message: `${format} needs a positive target` });
    if (!enabled.has(format) && value.weeklyMix[format] !== 0) context.addIssue({ code: "custom", message: `${format} must be zero when disabled` });
  }
});

export const contentBrandKitUpdateRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
  brandKit: contentBrandKitSnapshotSchema,
}).strict();

export const contentBrandLogoImportRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().min(4).max(7_500_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();

export const contentBrandDirectionRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(300),
  landingPageUrl: z.string().trim().url().max(500).nullable().optional().default(null),
  description: z.string().trim().min(10).max(2_000).nullable().optional().default(null),
  useLogo: z.boolean().optional().default(true),
}).strict().superRefine((value, context) => {
  if (!value.landingPageUrl && !value.description && !value.useLogo) {
    context.addIssue({ code: "custom", message: "A landing page, logo or description is required" });
  }
});

export const contentBrandDirectionProposalSchema = z.object({
  colors: z.object({
    primary: hexColorSchema,
    accent: hexColorSchema,
    background: hexColorSchema,
    text: hexColorSchema,
  }).strict(),
  typography: z.enum(["inter", "space_grotesk", "system"]),
  imageStyle: z.enum(["editorial", "technical", "bold", "minimal"]),
  rationale: z.string().trim().min(10).max(1_000),
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
