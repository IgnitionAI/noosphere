ALTER TYPE "public"."product_research_status" ADD VALUE 'completed' BEFORE 'failed';--> statement-breakpoint
ALTER TYPE "public"."product_research_status" ADD VALUE 'partial' BEFORE 'failed';--> statement-breakpoint
ALTER TYPE "public"."product_research_status" ADD VALUE 'interrupted' BEFORE 'failed';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'product_truth';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'problem_mapping';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'organization_discovery';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'market_investigation';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'buying_context';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'sourcing_validation';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'icp_composition';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'adversarial_review';--> statement-breakpoint
ALTER TYPE "public"."research_stage" ADD VALUE 'objective_ranking';