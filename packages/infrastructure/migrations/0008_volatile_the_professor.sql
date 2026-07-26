CREATE TYPE "public"."contact_identity_type" AS ENUM('email', 'linkedin', 'phone', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('active', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."contact_verification_status" AS ENUM('unknown', 'verified', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."crm_source" AS ENUM('manual', 'csv', 'icp_research', 'provider');--> statement-breakpoint
CREATE TYPE "public"."suppression_channel" AS ENUM('global', 'email', 'linkedin', 'whatsapp');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(300) NOT NULL,
	"normalized_domain" varchar(300),
	"sector" varchar(200),
	"employee_count_min" integer,
	"employee_count_max" integer,
	"location" varchar(300),
	"linkedin_url" varchar(600),
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "crm_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "company_field_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"field" varchar(120) NOT NULL,
	"source" varchar(200) NOT NULL,
	"confidence" numeric(5, 4),
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_employments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"started_on" varchar(10),
	"ended_on" varchar(10),
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"type" "contact_identity_type" NOT NULL,
	"value" varchar(600) NOT NULL,
	"normalized_value" varchar(600) NOT NULL,
	"verification_status" "contact_verification_status" DEFAULT 'unknown' NOT NULL,
	"source" "crm_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_suppressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"channel" "suppression_channel" NOT NULL,
	"identity_type" "contact_identity_type",
	"normalized_value" varchar(600),
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"first_name" varchar(200) NOT NULL,
	"last_name" varchar(200) NOT NULL,
	"photo_url" varchar(600),
	"preferred_channel" varchar(40),
	"status" "contact_status" DEFAULT 'active' NOT NULL,
	"source" "crm_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_field_provenance" ADD CONSTRAINT "company_field_provenance_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_employments" ADD CONSTRAINT "contact_employments_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_employments" ADD CONSTRAINT "contact_employments_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_workspace_domain_uq" ON "companies" USING btree ("workspace_id","normalized_domain") WHERE "companies"."normalized_domain" is not null;--> statement-breakpoint
CREATE INDEX "companies_workspace_name_idx" ON "companies" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "company_field_provenance_company_idx" ON "company_field_provenance" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_employments_current_uq" ON "contact_employments" USING btree ("workspace_id","contact_id") WHERE "contact_employments"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_value_uq" ON "contact_identities" USING btree ("workspace_id","type","normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suppressions_fingerprint_uq" ON "contact_suppressions" USING btree ("workspace_id","identity_type","normalized_value") WHERE "contact_suppressions"."normalized_value" is not null;--> statement-breakpoint
CREATE INDEX "contacts_workspace_name_idx" ON "contacts" USING btree ("workspace_id","last_name","first_name");