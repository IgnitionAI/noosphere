-- Public PKCE clients are registered before a user chooses a workspace. The
-- authorization code and tokens remain user/workspace bound after consent.
ALTER TABLE "mcp_oauth_clients" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "mcp_oauth_clients" ALTER COLUMN "workspace_id" DROP NOT NULL;
ALTER TABLE "mcp_oauth_clients" ALTER COLUMN "workspace_slug" DROP NOT NULL;
