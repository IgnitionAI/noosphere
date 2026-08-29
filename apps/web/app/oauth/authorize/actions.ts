"use server";

import { redirect } from "next/navigation";
import {
  parseMcpOAuthAuthorizationRequest,
  type McpOAuthAuthorizationRequest,
} from "@/lib/mcp-oauth-consent";
import { mcpOAuthConsentGateway } from "./gateway";

/**
 * The OAuth request is bound by the server component, not read from hidden
 * fields. A malicious browser can alter the DOM, but cannot change the
 * signed server-action argument; the API still revalidates every value.
 */
export async function decideMcpAuthorization(
  expected: McpOAuthAuthorizationRequest,
  formData: FormData,
): Promise<void> {
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "approve" && decision !== "deny") {
    throw new Error("Choisissez d’autoriser ou de refuser l’accès.");
  }
  const request = parseMcpOAuthAuthorizationRequest({
    response_type: expected.responseType,
    client_id: expected.clientId,
    redirect_uri: expected.redirectUri,
    state: expected.state,
    code_challenge: expected.codeChallenge,
    code_challenge_method: expected.codeChallengeMethod,
    scope: expected.scope,
    ...(expected.resource ? { resource: expected.resource } : {}),
    workspace_slug: expected.workspaceSlug,
  });
  const location = await mcpOAuthConsentGateway.decide(request, decision);
  redirect(location);
}

/**
 * Workspace selection is deliberately a navigation back to GET. The GET
 * fetches a fresh Better Auth session/membership view before displaying the
 * consent form, and the eventual POST rechecks it again.
 */
export async function selectMcpOAuthWorkspace(formData: FormData): Promise<void> {
  const workspaceSlug = String(formData.get("workspace_slug") ?? "").trim();
  const values = {
    response_type: String(formData.get("response_type") ?? ""),
    client_id: String(formData.get("client_id") ?? ""),
    redirect_uri: String(formData.get("redirect_uri") ?? ""),
    state: String(formData.get("state") ?? ""),
    code_challenge: String(formData.get("code_challenge") ?? ""),
    code_challenge_method: String(formData.get("code_challenge_method") ?? ""),
    scope: String(formData.get("scope") ?? ""),
    resource: String(formData.get("resource") ?? ""),
    workspace_slug: workspaceSlug,
  };
  const request = parseMcpOAuthAuthorizationRequest(values);
  const query = new URLSearchParams({
    response_type: request.responseType,
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallengeMethod,
    scope: request.scope,
    workspace_slug: request.workspaceSlug,
    ...(request.resource ? { resource: request.resource } : {}),
  });
  redirect(`/oauth/authorize?${query.toString()}`);
}
