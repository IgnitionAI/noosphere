import { z } from "zod";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";

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
