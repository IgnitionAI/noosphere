import { describe, expect, test } from "bun:test";
import { toMcpOperationView, type McpOperationRecord, type McpOperationStore } from "@outbound/application/mcp/mcp-durable-operations";

describe("MCP durable operation contract", () => {
  test("stores the domain job handle and run result reference", async () => {
    const calls: Parameters<McpOperationStore["createQueued"]>[0][] = [];
    const store: McpOperationStore = {
      async createQueued(input) {
        calls.push(input);
        return { inserted: true, record: record(input) };
      },
      async get() { return null; },
    };
    const input = {
      context: { workspaceId: "workspace-1", clientId: "client-1", userId: "user-1", role: "owner", scopes: ["mcp:write"], audience: "/mcp" } as never,
      command: { operation: "content_draft_create", requestKey: "request-1", inputHash: "a".repeat(64), arguments: {} } as never,
      operationId: "operation-1",
      jobId: "content-job-1",
      correlationId: "content-generation:run-1",
      resultRefs: [{ type: "ContentGenerationRun", id: "run-1" }],
      now: new Date("2026-08-29T12:00:00Z"),
    };
    await store.createQueued(input);
    expect(calls[0]?.jobId).toBe("content-job-1");
    expect(calls[0]?.resultRefs).toEqual([{ type: "ContentGenerationRun", id: "run-1" }]);
  });

  test("projects only bounded public fields and replaces unsafe error details", () => {
    const value = toMcpOperationView({
      ...record({
        context: { workspaceId: "workspace-1", clientId: "client-1", userId: "user-1", role: "owner", scopes: ["mcp:write"], audience: "/mcp" } as never,
        command: { operation: "content_draft_create", requestKey: "request-1", inputHash: "a".repeat(64), arguments: {} } as never,
        operationId: crypto.randomUUID(), jobId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now: new Date("2026-08-29T12:00:00Z"),
        resultRefs: [{ type: "ContentGenerationRun", id: "run-1" }],
      }),
      errorCode: "provider unavailable: secret",
      resultRefs: Array.from({ length: 25 }, (_, index) => ({ type: "run", id: String(index) })),
    });
    expect(value).toMatchObject({ status: "queued", errorCode: null });
    expect(value.resultRefs).toHaveLength(20);
    expect(Object.keys(value).sort()).toEqual([
      "correlationId", "createdAt", "errorCode", "jobId", "operationId", "operationUri", "resultRefs", "status", "updatedAt",
    ]);
    expect(JSON.stringify(value)).not.toContain("inputHash");
    expect(JSON.stringify(value)).not.toContain("provider unavailable");
  });
});

function record(input: Parameters<McpOperationStore["createQueued"]>[0]): McpOperationRecord {
  return {
    operationId: input.operationId,
    workspaceId: input.context.workspaceId,
    clientId: input.context.clientId,
    userId: input.context.userId,
    tool: input.command.operation,
    requestKey: input.command.requestKey,
    inputHash: input.command.inputHash,
    jobId: input.jobId,
    correlationId: input.correlationId,
    status: "queued",
    resultRefs: input.resultRefs ?? [],
    errorCode: null,
    operationUri: `noosphere://operations/${input.operationId}`,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
