CREATE TYPE "public"."workspace_invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "email" varchar(320) NOT NULL,
  "proposed_role" "workspace_role" NOT NULL,
  "status" "workspace_invitation_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "invited_by" uuid,
  "accepted_by" uuid,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_invitations_workspace_id_uq" UNIQUE("workspace_id", "id"),
  CONSTRAINT "workspace_invitations_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_invitations_invited_by_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."auth_users"("id") ON DELETE set null,
  CONSTRAINT "workspace_invitations_accepted_by_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."auth_users"("id") ON DELETE set null
);--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_status_idx" ON "workspace_invitations" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_pending_email_uq" ON "workspace_invitations" USING btree ("workspace_id", lower("email")) WHERE "status" = 'pending';
