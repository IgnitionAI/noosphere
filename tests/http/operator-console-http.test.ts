import { describe, expect, test } from "bun:test";
import { createOperatorConsoleHttpHandler } from "@outbound/interface/http/operator-console-handler";

const workspaceId = "00000000-0000-4000-8000-000000000401";
const userId = "00000000-0000-4000-8000-000000000402";
const jobId = "00000000-0000-4000-8000-000000000403";

describe("F-003 operator console HTTP", () => {
  test("allows operational reads but reserves requeue for administrators", async () => {
    const operator = handler("operator");
    expect((await operator(request("/api/v1/console/jobs?status=failed"))).status).toBe(200);
    expect((await operator(request("/api/v1/console/dead-letters"))).status).toBe(200);
    expect((await operator(request("/api/v1/console/webhooks/rejected"))).status).toBe(200);
    expect((await operator(request("/api/v1/console/correlations/run%3A123"))).status).toBe(200);
    expect((await operator(request(`/api/v1/console/jobs/${jobId}/actions/requeue`, "POST"))).status).toBe(403);
    expect((await handler("owner")(request(`/api/v1/console/jobs/${jobId}/actions/requeue`, "POST"))).status).toBe(202);
  });

  test("keeps the console unavailable to reviewer and viewer", async () => {
    expect((await handler("reviewer")(request("/api/v1/console/jobs"))).status).toBe(403);
    expect((await handler("viewer")(request("/api/v1/console/jobs"))).status).toBe(403);
  });

  test("fails closed on invalid filters", async () => {
    const owner = handler("owner");
    expect((await owner(request("/api/v1/console/jobs?status=unknown"))).status).toBe(422);
    expect((await owner(request("/api/v1/console/jobs?from=tomorrow-ish"))).status).toBe(422);
    expect((await owner(request("/api/v1/console/correlations/%20"))).status).toBe(422);
  });
});

function handler(role: "owner" | "operator" | "reviewer" | "viewer") {
  const service = {
    async listJobs() { return []; },
    async listDeadLetters() { return []; },
    async listRejectedWebhooks() { return []; },
    async traceCorrelation(input: { correlationId: string }) { return { correlationId: input.correlationId, jobs: [], events: [], audit: [] }; },
    async requeue() { return { id: jobId, type: "test.job", status: "pending" as const, attempts: 0, maxAttempts: 3, correlationId: "test:job", idempotencyKey: "test-job", payloadPreview: {}, lastErrorCode: null, lastErrorMessage: null, availableAt: new Date(), createdAt: new Date(), updatedAt: new Date(), requeued: true as const }; },
  };
  return createOperatorConsoleHttpHandler({ contextResolver: { async resolve() { return { workspaceId, userId, role }; } }, service });
}

function request(pathname: string, method = "GET") {
  return new Request(`http://localhost${pathname}`, { method, headers: { "x-workspace-slug": "workspace" } });
}
