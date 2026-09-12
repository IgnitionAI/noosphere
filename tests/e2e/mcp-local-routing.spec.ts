import { expect, test } from "@playwright/test";

test("the application origin serves the MCP endpoints advertised by OAuth", async ({ request, baseURL }) => {
  const discovery = await request.get("/.well-known/oauth-protected-resource/mcp");
  expect(discovery.status()).toBe(200);
  const resource = await discovery.json();
  expect(resource.resource).toBe(`${baseURL}/mcp`);
  const metadata = await request.get("/.well-known/oauth-authorization-server");
  expect(metadata.status()).toBe(200);
  const oauth = await metadata.json();
  expect(oauth.authorization_endpoint).toBe(`${baseURL}/oauth/authorize`);
  const mcp = await request.get("/mcp", { headers: { Accept: "application/json, text/event-stream" } });
  expect(mcp.status()).toBe(401);
  expect(mcp.headers()["www-authenticate"]).toContain(baseURL!);
  // Missing grant/client parameters must reach OAuth validation, not Next's 404.
  for (const endpoint of [oauth.token_endpoint, oauth.revocation_endpoint, oauth.registration_endpoint]) {
    const result = await request.post(endpoint, { data: {}, headers: { "Content-Type": "application/json" } });
    expect(result.status()).toBeGreaterThanOrEqual(400);
    expect(result.status()).toBeLessThan(500);
    expect(result.status()).not.toBe(404);
  }
});
