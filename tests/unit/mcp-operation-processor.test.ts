import { describe, expect, test } from "bun:test";
import type { LeasedJob } from "@outbound/application/jobs/job-queue";
import type { McpOperationRecord } from "@outbound/application/mcp/mcp-durable-operations";
import { McpTrackedJobLifecycle, type McpTrackedJobLifecycleStore } from "@outbound/application/mcp/mcp-tracked-job-lifecycle";

const now = new Date("2026-08-29T12:00:00.000Z");

describe("McpTrackedJobLifecycle", () => {
  test("leaves an untracked domain job unchanged", async () => {
    const state = fixture(null);
    const lifecycle = new McpTrackedJobLifecycle(state.store, async () => [{ type: "company", id: "company-1" }], { now: () => now });

    const context = await lifecycle.beforeDispatch(state.job);
    await lifecycle.afterSuccess(context);
    await lifecycle.afterRetry(context, "dead_lettered", new Error("ignored"));

    expect(state.calls).toEqual(["findByJob"]);
  });

  test("marks a tracked domain job running then completes with resolver refs", async () => {
    const state = fixture("queued");
    let resolvedJobId: string | undefined;
    const lifecycle = new McpTrackedJobLifecycle(
      state.store,
      async ({ job }) => {
        resolvedJobId = job.id;
        return [{ type: "company", id: "company-1" }];
      },
      { now: () => now },
    );

    const context = await lifecycle.beforeDispatch(state.job);
    await lifecycle.afterSuccess(context);

    expect(resolvedJobId).toBe(state.job.id);
    expect(state.calls).toEqual(["findByJob", "markRunning", "findJob", "complete"]);
    expect(state.completeRequest?.resultRefs).toEqual([{ type: "company", id: "company-1" }]);
  });

  test("does not complete when the processor returns before the domain job is completed", async () => {
    const state = fixture("queued", "retry");
    const lifecycle = new McpTrackedJobLifecycle(state.store, async () => [{ type: "company", id: "company-1" }], { now: () => now });
    const context = await lifecycle.beforeDispatch(state.job);

    await lifecycle.afterSuccess(context);

    expect(state.calls).toEqual(["findByJob", "markRunning", "findJob"]);
    expect(state.completeRequest).toBeUndefined();
  });

  test("keeps a tracked operation non-terminal when the queue schedules a retry", async () => {
    const state = fixture("queued");
    const lifecycle = new McpTrackedJobLifecycle(state.store, async () => [], { now: () => now });
    const context = await lifecycle.beforeDispatch(state.job);

    await lifecycle.afterRetry(context, "scheduled", new Error("temporary"));
    await lifecycle.afterRetry(context, "deferred", new Error("not due yet"));

    expect(state.calls).toEqual(["findByJob", "markRunning"]);
    expect(state.failRequest).toBeUndefined();
  });

  test("marks failed only after the existing queue dead-letters the job", async () => {
    const state = fixture("running");
    const lifecycle = new McpTrackedJobLifecycle(state.store, async () => [], { now: () => now });
    const context = await lifecycle.beforeDispatch(state.job);

    await lifecycle.afterRetry(context, "dead_lettered", Object.assign(new Error("provider unavailable"), { code: "PROVIDER_DOWN" }));

    expect(state.calls).toEqual(["findByJob", "markRunning", "fail"]);
    expect(state.failRequest).toMatchObject({ errorCode: "PROVIDER_DOWN", jobId: state.job.id });
  });

  test("treats a workspace or job mismatch as an untracked job", async () => {
    const state = fixture(null);
    const lifecycle = new McpTrackedJobLifecycle(state.store, async () => [{ type: "company", id: "should-not-run" }], { now: () => now });

    const context = await lifecycle.beforeDispatch({ ...state.job, workspaceId: "workspace-other" });
    await lifecycle.afterSuccess(context);

    expect(state.calls).toEqual(["findByJob"]);
  });

  test("does not transition an already completed operation after worker restart", async () => {
    const state = fixture("completed");
    let resolved = false;
    const lifecycle = new McpTrackedJobLifecycle(state.store, async () => {
      resolved = true;
      return [{ type: "company", id: "should-not-run" }];
    }, { now: () => now });

    const context = await lifecycle.beforeDispatch(state.job);
    await lifecycle.afterSuccess(context);
    await lifecycle.afterRetry(context, "dead_lettered", new Error("late retry"));

    expect(resolved).toBe(false);
    expect(state.calls).toEqual(["findByJob"]);
  });

  test("short-circuits a cancelled pending operation before domain effects", async () => {
    const state = fixture("cancelled");
    const lifecycle = new McpTrackedJobLifecycle(state.store, async () => [{ type: "company", id: "must-not-run" }], { now: () => now });

    const context = await lifecycle.beforeDispatch(state.job);
    await lifecycle.afterSuccess(context);

    expect(context?.active).toBe(false);
    expect(state.calls).toEqual(["findByJob"]);
    expect(state.completeRequest).toBeUndefined();
  });
});

function fixture(status: McpOperationRecord["status"] | null, jobStatus: "pending" | "running" | "retry" | "completed" | "dead_lettered" = "completed") {
  const calls: string[] = [];
  const job = {
    id: "job-1",
    workspaceId: "workspace-1",
    type: "content.asset.generate",
    payload: { contentId: "content-1" },
    idempotencyKey: "content:asset:1",
    correlationId: "correlation-1",
    maxAttempts: 5,
    attempts: 1,
    availableAt: now,
    lockedBy: "worker-1",
    lockedUntil: new Date(now.getTime() + 60_000),
  } satisfies LeasedJob;
  const record: McpOperationRecord = {
    operationId: "operation-1",
    workspaceId: job.workspaceId,
    clientId: "client-1",
    userId: "user-1",
    tool: "content_draft_create",
    requestKey: "request-1",
    inputHash: "a".repeat(64),
    jobId: job.id,
    correlationId: job.correlationId,
    status: status ?? "queued",
    resultRefs: [],
    errorCode: null,
    operationUri: "noosphere://operations/operation-1",
    createdAt: now,
    updatedAt: now,
  };
  let completeRequest: Parameters<McpTrackedJobLifecycleStore["complete"]>[0] | undefined;
  let failRequest: Parameters<McpTrackedJobLifecycleStore["fail"]>[0] | undefined;
  const store: McpTrackedJobLifecycleStore = {
    async findByJob(input) {
      calls.push("findByJob");
      if (status === null || input.workspaceId !== job.workspaceId || input.jobId !== job.id) return null;
      return record;
    },
    async markRunning(input) {
      calls.push("markRunning");
      return { ...record, status: "running", updatedAt: input.now };
    },
    async findJob(input) {
      calls.push("findJob");
      expect(input).toEqual({ workspaceId: job.workspaceId, jobId: job.id });
      return jobStatus;
    },
    async complete(input) {
      calls.push("complete");
      completeRequest = input;
      return { ...record, status: "completed", resultRefs: [...input.resultRefs], updatedAt: input.now };
    },
    async fail(input) {
      calls.push("fail");
      failRequest = input;
      return { ...record, status: "failed", errorCode: input.errorCode, updatedAt: input.now };
    },
  };
  return { calls, job, store, get completeRequest() { return completeRequest; }, get failRequest() { return failRequest; } };
}
