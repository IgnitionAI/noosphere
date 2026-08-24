import { describe, expect, test } from "bun:test";
import { createEvaluationHttpHandler } from "@outbound/interface/http/evaluation-handler";

const workspaceId = "00000000-0000-4000-8000-000000000301";
const promptId = "00000000-0000-4000-8000-000000000302";
const configurationId = "00000000-0000-4000-8000-000000000303";
const datasetId = "00000000-0000-4000-8000-000000000304";
const runId = "00000000-0000-4000-8000-000000000305";
const aiRunId = "00000000-0000-4000-8000-000000000306";

describe("AI-140 evaluation HTTP", () => {
  test("lets an operator read and give feedback but never launch or promote", async () => {
    const handle = handler("operator");
    expect((await handle(request("/api/v1/evaluation-datasets"))).status).toBe(200);
    expect((await handle(request("/api/v1/evaluation-runs", "POST", runBody()))).status).toBe(403);
    expect((await handle(request(`/api/v1/ai-configurations/${configurationId}/actions/promote`, "POST"))).status).toBe(403);
    expect((await handle(request(`/api/v1/ai-runs/${aiRunId}/feedback`, "POST", { rating: 1, reason: "Bonne qualification" }))).status).toBe(201);
  });

  test("keeps the technical studio unavailable to reviewers and viewers", async () => {
    expect((await handler("reviewer")(request("/api/v1/evaluation-runs"))).status).toBe(403);
    expect((await handler("viewer")(request("/api/v1/ai-configurations"))).status).toBe(403);
  });

  test("lets an owner create immutable inputs, launch, compare and promote", async () => {
    const handle = handler("owner");
    expect((await handle(request("/api/v1/evaluation-datasets", "POST", datasetBody()))).status).toBe(201);
    expect((await handle(request("/api/v1/ai-prompt-versions", "POST", { capability: "setter", content: "Prompt" }))).status).toBe(201);
    expect((await handle(request("/api/v1/ai-configurations", "POST", { capability: "setter", provider: "kimi-code", model: "k3", promptVersionId: promptId, status: "shadow" }))).status).toBe(201);
    expect((await handle(request("/api/v1/evaluation-runs", "POST", runBody()))).status).toBe(202);
    expect((await handle(request(`/api/v1/evaluation-runs/compare?left=${runId}&right=${runId}`))).status).toBe(200);
    expect((await handle(request(`/api/v1/ai-configurations/${configurationId}/actions/promote`, "POST"))).status).toBe(200);
  });
});

function handler(role: "owner" | "operator" | "reviewer" | "viewer") {
  const service = {
    async createDataset() { return { id: datasetId }; },
    async listDatasets() { return []; },
    async createPromptVersion() { return { id: promptId }; },
    async createConfiguration() { return { id: configurationId }; },
    async listConfigurations() { return []; },
    async requestRun() { return { id: runId, status: "queued" }; },
    async retryFailedRun() { return { id: runId, status: "queued" }; },
    async listRuns() { return []; },
    async getRun() { return { id: runId, status: "completed" }; },
    async compareRuns() { return { left: { id: runId }, right: { id: runId } }; },
    async promoteConfiguration() { return { id: configurationId, status: "active" }; },
    async recordFeedback() { return { id: crypto.randomUUID(), rating: 1 }; },
  };
  return createEvaluationHttpHandler({
    contextResolver: { async resolve() { return { userId: "00000000-0000-4000-8000-000000000300", workspaceId, role }; } },
    service,
  });
}

function datasetBody() {
  return { capability: "setter", name: "Setter", rubricVersion: "v1", cases: [{ name: "Cas A", input: { message: "SYNTHETIC_MESSAGE" }, expected: { classification: "qualified" } }] };
}

function runBody() {
  return { datasetId, configurationId, requestKey: "evaluation-request" };
}

function request(pathname: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${pathname}`, { method, headers: { "content-type": "application/json", "x-workspace-slug": "workspace" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
