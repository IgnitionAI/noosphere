import { describe, expect, test } from "bun:test";
import {
  createMcpOAuthConsentGateway,
  parseMcpOAuthAuthorizationRequest,
  type McpOAuthAuthorizationRequest,
} from "../../apps/web/lib/mcp-oauth-consent";

const request: McpOAuthAuthorizationRequest = {
  responseType: "code",
  clientId: "client-public",
  redirectUri: "https://client.example/callback",
  state: "opaque-state",
  codeChallenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  codeChallengeMethod: "S256",
  scope: "mcp:read",
  resource: "https://noosphere.example.com/mcp",
  workspaceSlug: "acme",
};

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}

function gateway(fetchImpl: typeof fetch, overrides: { session?: unknown | null; workspaces?: readonly { slug: string }[] } = {}) {
  return createMcpOAuthConsentGateway({
    apiOrigin: "http://api.internal:3001",
    publicHost: "noosphere.example.com",
    fetch: fetchImpl,
    readCookieHeader: async () => "better-auth.session_token=session",
    getSession: async () => overrides.session === undefined ? { user: { id: "user-1" } } : overrides.session,
    listWorkspaces: async () => overrides.workspaces ?? [{ slug: "acme" }],
  });
}

describe("MCP OAuth browser consent gateway", () => {
  test("parses and normalizes the approval scope", () => {
    const parsed = parseMcpOAuthAuthorizationRequest(new URLSearchParams({
      response_type: "code",
      client_id: "client-public",
      redirect_uri: request.redirectUri,
      state: request.state,
      code_challenge: request.codeChallenge,
      code_challenge_method: "S256",
      scope: "mcp:approve mcp:read mcp:approve mcp:write",
      workspace_slug: request.workspaceSlug,
    }));
    expect(parsed.scope).toBe("mcp:approve mcp:read mcp:write");
  });

  test("accept revalidates the complete request server-side and returns only code/state", async () => {
    let submitted: Request | undefined;
    const consent = gateway(fakeFetch(async (input, init) => {
      submitted = new Request(input, init);
      return new Response(null, {
        status: 302,
        headers: { location: "https://client.example/callback?code=one-use-code&state=opaque-state" },
      });
    }));

    const redirect = await consent.decide(request, "approve");

    expect(redirect).toBe("https://client.example/callback?code=one-use-code&state=opaque-state");
    expect(submitted?.method).toBe("POST");
    expect(new URL(submitted!.url).origin).toBe("http://api.internal:3001");
    expect(submitted?.headers.get("host")).toBe("noosphere.example.com");
    expect(submitted?.headers.get("cookie")).toContain("better-auth.session_token");
    const body = new URLSearchParams(await submitted!.text());
    expect(body.get("client_id")).toBe(request.clientId);
    expect(body.get("redirect_uri")).toBe(request.redirectUri);
    expect(body.get("state")).toBe(request.state);
    expect(body.get("code_challenge")).toBe(request.codeChallenge);
    expect(body.get("workspace_slug")).toBe(request.workspaceSlug);
    expect(body.get("decision")).toBe("approve");
    expect(body.get("access_token")).toBeNull();
    expect(body.get("refresh_token")).toBeNull();
  });

  test("refusal uses OAuth access_denied and preserves state without issuing a code", async () => {
    const consent = gateway(fakeFetch(async () => new Response(null, {
      status: 302,
      headers: { location: "https://client.example/callback?error=access_denied&state=opaque-state" },
    })));

    await expect(consent.decide(request, "deny")).resolves.toBe(
      "https://client.example/callback?error=access_denied&state=opaque-state",
    );
  });

  test("requires a Better Auth session and a currently active workspace", async () => {
    const noSession = gateway(fakeFetch(async () => { throw new Error("must not call upstream"); }), { session: null });
    await expect(noSession.decide(request, "approve")).rejects.toMatchObject({ status: 401, oauthCode: "login_required" });

    const removedWorkspace = gateway(fakeFetch(async () => { throw new Error("must not call upstream"); }), { workspaces: [] });
    await expect(removedWorkspace.decide(request, "approve")).rejects.toMatchObject({ status: 403, oauthCode: "access_denied" });
  });

  test("rejects altered redirect, state and invalid PKCE through the server API", async () => {
    const fetchImpl = fakeFetch(async () => new Response(JSON.stringify({ error: "invalid_request", error_description: "request changed" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
    const consent = gateway(fetchImpl);
    await expect(consent.decide({ ...request, redirectUri: "https://attacker.example/callback" }, "approve"))
      .rejects.toMatchObject({ status: 400, oauthCode: "invalid_request" });
    await expect(consent.decide({ ...request, state: "" }, "approve"))
      .rejects.toMatchObject({ status: 400, oauthCode: "invalid_request" });
    await expect(consent.decide({ ...request, codeChallenge: "plain" }, "approve"))
      .rejects.toMatchObject({ status: 400, oauthCode: "invalid_request" });
  });

  test("never accepts an upstream redirect containing browser tokens", async () => {
    const consent = gateway(fakeFetch(async () => new Response(null, {
      status: 302,
      headers: { location: "https://client.example/callback?access_token=secret&state=opaque-state" },
    })));
    await expect(consent.decide(request, "approve")).rejects.toMatchObject({ status: 502, oauthCode: "server_error" });
  });
});
