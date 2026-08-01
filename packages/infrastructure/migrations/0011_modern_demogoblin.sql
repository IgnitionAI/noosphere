ALTER TYPE "public"."research_stage" ADD VALUE 'buyer_landscape_discovery' BEFORE 'segment_synthesis';--> statement-breakpoint
UPDATE "product_research_runs"
SET "brief" = "brief" || '{"researchVersion":1}'::jsonb
WHERE NOT ("brief" ? 'researchVersion');
