import "server-only";

import { cookies } from "next/headers";
import { getSession, listWorkspaces } from "@/lib/api";
import { createMcpOAuthConsentGateway } from "@/lib/mcp-oauth-consent";

const issuerHost = (() => {
  const issuer = process.env.BETTER_AUTH_URL;
  if (!issuer) return undefined;
  try { return new URL(issuer).host; } catch { return undefined; }
})();

export const mcpOAuthConsentGateway = createMcpOAuthConsentGateway({
  apiOrigin: process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001",
  ...(issuerHost ? { publicHost: issuerHost } : {}),
  fetch,
  readCookieHeader: async () => (await cookies()).toString(),
  getSession,
  listWorkspaces: async () => listWorkspaces(),
});
