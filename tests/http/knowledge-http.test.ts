import { describe, expect, test } from "bun:test";
import { createKnowledgeHttpHandler } from "@outbound/interface/http/knowledge-handler";

const workspaceId = "00000000-0000-4000-8000-000000000201";
const sourceId = "00000000-0000-4000-8000-000000000202";
const claimId = "00000000-0000-4000-8000-000000000203";

describe("F-050 knowledge HTTP", () => {
  test("lets an operator propose but not validate or withdraw", async () => {
    const handle = handler("operator");
    expect((await handle(request("/api/v1/knowledge-sources", "POST", sourceBody()))).status).toBe(201);
    expect((await handle(request(`/api/v1/knowledge-sources/${sourceId}/actions/validate`, "POST"))).status).toBe(403);
    expect((await handle(request(`/api/v1/knowledge-sources/${sourceId}/actions/withdraw`, "POST", { reason: "Obsolète" }))).status).toBe(403);
  });

  test("shows a viewer only validated and fresh content", async () => {
    const calls: unknown[] = [];
    const handle = handler("viewer", {
      async listSources(input: unknown) { calls.push(input); return [
        { id: sourceId, status: "validated", effectiveStatus: "validated", freshnessUntil: "2026-09-01T00:00:00.000Z" },
        { id: crypto.randomUUID(), status: "draft", effectiveStatus: "draft", freshnessUntil: "2026-09-01T00:00:00.000Z" },
      ]; },
      async listClaims() { return [
        { id: claimId, effectiveStatus: "validated" },
        { id: crypto.randomUUID(), effectiveStatus: "needs_resourcing" },
      ]; },
    });
    const sources = await handle(request("/api/v1/knowledge-sources?status=draft"));
    expect(await sources.json()).toEqual({ data: [expect.objectContaining({ id: sourceId })] });
    expect(calls).toEqual([expect.objectContaining({ workspaceId, fresh: true })]);
    const claims = await handle(request("/api/v1/knowledge-claims"));
    expect(await claims.json()).toEqual({ data: [expect.objectContaining({ id: claimId })] });
  });

  test("lets an owner validate and requires a withdrawal reason", async () => {
    const handle = handler("owner");
    expect((await handle(request(`/api/v1/knowledge-sources/${sourceId}/actions/validate`, "POST"))).status).toBe(200);
    expect((await handle(request(`/api/v1/knowledge-claims/${claimId}/actions/validate`, "POST"))).status).toBe(200);
    expect((await handle(request(`/api/v1/knowledge-sources/${sourceId}/actions/withdraw`, "POST", { reason: "" }))).status).toBe(422);
  });
});

function handler(role: "owner" | "operator" | "viewer", overrides: Record<string, unknown> = {}) {
  const service = {
    async listSources() { return []; },
    async createSource() { return { id: sourceId, status: "draft" }; },
    async validateSource() { return { id: sourceId, status: "validated" }; },
    async withdrawSource() { return { id: sourceId, status: "withdrawn" }; },
    async listClaims() { return []; },
    async createClaim() { return { id: claimId, status: "draft" }; },
    async validateClaim() { return { id: claimId, status: "validated" }; },
    ...overrides,
  };
  return createKnowledgeHttpHandler({
    contextResolver: { async resolve() { return { userId: "00000000-0000-4000-8000-000000000200", workspaceId, role }; } },
    service,
  });
}

function sourceBody() {
  return {
    type: "proof",
    title: "Preuve",
    content: "Déploiement dans une infrastructure privée.",
    researchDocumentId: null,
    authorName: "IgnitionAI",
    publishedAt: "2026-08-01T00:00:00.000Z",
    freshnessUntil: "2026-09-01T00:00:00.000Z",
  };
}

function request(pathname: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-workspace-slug": "workspace" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
