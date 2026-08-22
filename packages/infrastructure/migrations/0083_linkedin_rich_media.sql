ALTER TABLE "content_assets" DROP CONSTRAINT IF EXISTS "content_assets_type_ck";--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_type_ck" CHECK ("content_assets"."type" in ('linkedin_text', 'linkedin_image', 'linkedin_document', 'linkedin_video'));--> statement-breakpoint

CREATE TABLE "content_brand_kits" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_brand_kits_version_ck" CHECK ("content_brand_kits"."version" > 0)
);--> statement-breakpoint

CREATE TABLE "content_media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"filename" varchar(300) NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"page_count" integer,
	"duration_seconds" integer,
	"alt_text" varchar(500) NOT NULL,
	"render_manifest" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_media_assets_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "content_media_assets_kind_ck" CHECK ("content_media_assets"."kind" in ('image', 'document', 'video')),
	CONSTRAINT "content_media_assets_mime_ck" CHECK ("content_media_assets"."mime_type" in ('image/png', 'application/pdf', 'video/mp4')),
	CONSTRAINT "content_media_assets_size_ck" CHECK ("content_media_assets"."size_bytes" > 0 and "content_media_assets"."size_bytes" <= 104857600),
	CONSTRAINT "content_media_assets_dimensions_ck" CHECK (("content_media_assets"."width" is null or "content_media_assets"."width" > 0) and ("content_media_assets"."height" is null or "content_media_assets"."height" > 0) and ("content_media_assets"."page_count" is null or "content_media_assets"."page_count" > 0) and ("content_media_assets"."duration_seconds" is null or "content_media_assets"."duration_seconds" > 0))
);--> statement-breakpoint

ALTER TABLE "content_brand_kits" ADD CONSTRAINT "content_brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_brand_kits" ADD CONSTRAINT "content_brand_kits_updated_by_auth_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_media_assets" ADD CONSTRAINT "content_media_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_media_assets" ADD CONSTRAINT "content_media_assets_workspace_version_fk" FOREIGN KEY ("workspace_id","asset_version_id") REFERENCES "public"."content_asset_versions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_media_assets_workspace_version_uq" ON "content_media_assets" USING btree ("workspace_id","asset_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_media_assets_workspace_checksum_uq" ON "content_media_assets" USING btree ("workspace_id","asset_version_id","checksum_sha256");
