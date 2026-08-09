CREATE TYPE "public"."knowledge_source_type" AS ENUM('product_document', 'proof', 'customer_case', 'objection_response');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_status" AS ENUM('draft', 'validated', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."knowledge_claim_status" AS ENUM('draft', 'validated');--> statement-breakpoint
ALTER TABLE "offer_claims" ADD CONSTRAINT "offer_claims_workspace_id_uq" UNIQUE("workspace_id", "id");--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "type" "knowledge_source_type" NOT NULL,
  "title" varchar(500) NOT NULL,
  "content" text,
  "research_document_id" uuid,
  "author_name" varchar(300) NOT NULL,
  "published_at" timestamp with time zone NOT NULL,
  "freshness_until" timestamp with time zone,
  "status" "knowledge_source_status" DEFAULT 'draft' NOT NULL,
  "created_by" uuid,
  "validated_by" uuid,
  "validated_at" timestamp with time zone,
  "withdrawn_by" uuid,
  "withdrawn_at" timestamp with time zone,
  "withdrawal_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_sources_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "knowledge_sources_workspace_document_fk" FOREIGN KEY ("workspace_id", "research_document_id") REFERENCES "public"."research_documents"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "knowledge_sources_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "knowledge_sources_validated_by_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "knowledge_sources_withdrawn_by_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "knowledge_sources_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "knowledge_sources_content_or_document_ck" CHECK ("content" is not null or "research_document_id" is not null)
);--> statement-breakpoint
CREATE INDEX "knowledge_sources_workspace_status_idx" ON "knowledge_sources" ("workspace_id", "status", "freshness_until");--> statement-breakpoint
CREATE INDEX "knowledge_sources_fts_idx" ON "knowledge_sources" USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '')));--> statement-breakpoint
CREATE TABLE "knowledge_claims" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "claim" text NOT NULL,
  "status" "knowledge_claim_status" DEFAULT 'draft' NOT NULL,
  "offer_claim_id" uuid,
  "created_by" uuid,
  "validated_by" uuid,
  "validated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_claims_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "knowledge_claims_workspace_offer_claim_fk" FOREIGN KEY ("workspace_id", "offer_claim_id") REFERENCES "public"."offer_claims"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "knowledge_claims_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "knowledge_claims_validated_by_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "knowledge_claims_workspace_id_uq" UNIQUE("workspace_id", "id")
);--> statement-breakpoint
CREATE INDEX "knowledge_claims_workspace_status_idx" ON "knowledge_claims" ("workspace_id", "status");--> statement-breakpoint
CREATE INDEX "knowledge_claims_fts_idx" ON "knowledge_claims" USING gin (to_tsvector('simple', coalesce("claim", '')));--> statement-breakpoint
CREATE TABLE "knowledge_claim_sources" (
  "workspace_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_claim_sources_pk" PRIMARY KEY("workspace_id", "claim_id", "source_id"),
  CONSTRAINT "knowledge_claim_sources_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "knowledge_claim_sources_workspace_claim_fk" FOREIGN KEY ("workspace_id", "claim_id") REFERENCES "public"."knowledge_claims"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "knowledge_claim_sources_workspace_source_fk" FOREIGN KEY ("workspace_id", "source_id") REFERENCES "public"."knowledge_sources"("workspace_id", "id") ON DELETE restrict
);--> statement-breakpoint
CREATE INDEX "knowledge_claim_sources_source_idx" ON "knowledge_claim_sources" ("workspace_id", "source_id");
