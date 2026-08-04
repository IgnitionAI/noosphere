CREATE TABLE "workspace_channel_accounts" (
	"workspace_id" uuid NOT NULL,
	"channel" "prospecting_channel" NOT NULL,
	"provider" varchar(40) DEFAULT 'unipile' NOT NULL,
	"provider_account_id" text NOT NULL,
	"display_name" varchar(320) NOT NULL,
	"selected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_channel_accounts_workspace_id_channel_pk" PRIMARY KEY("workspace_id","channel")
);
--> statement-breakpoint
ALTER TABLE "workspace_channel_accounts" ADD CONSTRAINT "workspace_channel_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channel_accounts" ADD CONSTRAINT "workspace_channel_accounts_selected_by_auth_users_id_fk" FOREIGN KEY ("selected_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_channel_accounts_provider_idx" ON "workspace_channel_accounts" USING btree ("provider","provider_account_id");
