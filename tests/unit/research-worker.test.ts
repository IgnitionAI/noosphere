import { describe, expect, spyOn, test } from "bun:test";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import { SystemClock } from "@outbound/application/shared/ports";
import type { McpTrackedJobContext } from "@outbound/application/mcp/mcp-tracked-job-lifecycle";
import { ResearchWorker } from "../../apps/worker/src/research-worker";

describe("ResearchWorker job leases", () => {
  test("maintenance cannot block leasing ready business jobs", async () => {
    const events: string[] = [];
    const queue: JobQueue = {
      async enqueue() { return { inserted: true }; },
      async lease() { events.push("lease"); return []; },
      async renewLease() { return true; },
      async acknowledge() {},
      async defer() {},
      async retry() { return "scheduled"; },
    };
    const worker = new ResearchWorker(
      queue,
      { async process() {} } as unknown as ResearchOrchestrator,
      { now: () => new Date("2026-08-22T06:00:00.000Z") },
      { workerId: "worker-test", leaseMs: 60_000, batchSize: 1, pollIntervalMs: 1 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async reconcile() {
          events.push("maintenance-start");
          await Bun.sleep(25);
          events.push("maintenance-end");
          return 0;
        },
      },
    );

    await worker.tick();
    await Bun.sleep(30);

    expect(events).toEqual(["maintenance-start", "lease", "maintenance-end"]);
  });

  test("a long maintenance pass cannot monopolize every subsequent worker tick", async () => {
    let currentTime = new Date("2026-08-22T06:00:00.000Z");
    let maintenanceRuns = 0;
    let leaseCalls = 0;
    const queue: JobQueue = {
      async enqueue() { return { inserted: true }; },
      async lease() { leaseCalls += 1; return []; },
      async renewLease() { return true; },
      async acknowledge() {},
      async defer() {},
      async retry() { return "scheduled"; },
    };
    const worker = new ResearchWorker(
      queue,
      { async process() {} } as unknown as ResearchOrchestrator,
      { now: () => currentTime },
      { workerId: "worker-test", leaseMs: 60_000, batchSize: 1, pollIntervalMs: 1 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async reconcile() {
          maintenanceRuns += 1;
          currentTime = new Date(currentTime.getTime() + 61_000);
          return 0;
        },
      },
    );

    await worker.tick();
    await worker.tick();

    expect(maintenanceRuns).toBe(1);
    expect(leaseCalls).toBe(2);
  });

  test("does not requeue a domain effect when lifecycle completion fails after ack", async () => {
    const now = new Date("2026-08-22T06:00:00.000Z");
    const job: LeasedJob = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "content.asset.generate",
      payload: { contentId: crypto.randomUUID() },
      idempotencyKey: "content:asset:tracked",
      correlationId: "tracked:test",
      attempts: 1,
      maxAttempts: 5,
      availableAt: now,
      lockedBy: "worker-test",
      lockedUntil: new Date(now.getTime() + 60_000),
    };
    let leased = false;
    let acknowledgements = 0;
    let retries = 0;
    const queue: JobQueue = {
      async enqueue() { return { inserted: true }; },
      async lease() {
        if (leased) return [];
        leased = true;
        return [job];
      },
      async renewLease() { return true; },
      async acknowledge() { acknowledgements += 1; },
      async defer() {},
      async retry() { retries += 1; return "scheduled"; },
    };
    const trackedLifecycle = {
      async beforeDispatch() { return {} as McpTrackedJobContext; },
      async afterSuccess() { throw new Error("MCP_OPERATION_STORE_UNAVAILABLE"); },
      async afterRetry() {},
    };
    const worker = new ResearchWorker(
      queue,
      { async process() { throw new Error("wrong processor"); } } as unknown as ResearchOrchestrator,
      { now: () => now },
      {
        workerId: "worker-test",
        leaseMs: 60_000,
        batchSize: 1,
        pollIntervalMs: 1,
        jobTypes: ["content.asset.generate"],
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { async process() { await queue.acknowledge(job.id, job.lockedBy, now); } },
      undefined,
      undefined,
      undefined,
      trackedLifecycle,
    );
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await worker.tick();
    } finally {
      error.mockRestore();
    }

    expect(acknowledgements).toBe(1);
    expect(retries).toBe(0);
  });

  test("renews the lease while a long AI stage is executing", async () => {
    const now = new Date();
    const job: LeasedJob = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "research.stage.execute",
      payload: {},
      idempotencyKey: "run:stage",
      correlationId: "test",
      attempts: 1,
      maxAttempts: 5,
      availableAt: now,
      lockedBy: "worker-test",
      lockedUntil: new Date(now.getTime() + 90),
    };
    let leased = false;
    const renewals: Date[] = [];
    const queue: JobQueue = {
      async enqueue() {
        return { inserted: true };
      },
      async lease() {
        if (leased) return [];
        leased = true;
        return [job];
      },
      async renewLease(_jobId, _workerId, lockedUntil) {
        renewals.push(lockedUntil);
        return true;
      },
      async acknowledge() {},
      async defer() {},
      async retry() {
        return "scheduled";
      },
    };
    const orchestrator = {
      async process() {
        await Bun.sleep(180);
      },
    } as unknown as ResearchOrchestrator;
    const worker = new ResearchWorker(queue, orchestrator, new SystemClock(), {
      workerId: "worker-test",
      leaseMs: 90,
      batchSize: 1,
      pollIntervalMs: 1,
    });

    await worker.tick();

    expect(renewals.length).toBeGreaterThanOrEqual(2);
    expect(renewals.every((lockedUntil) => lockedUntil.getTime() > now.getTime())).toBe(true);
  });

  test("keeps a slow Setter command leased independently from the browser", async () => {
    const now = new Date();
    const job: LeasedJob = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "conversation.command.execute",
      payload: { commandId: crypto.randomUUID() },
      idempotencyKey: "conversation:setter:dry-run",
      correlationId: "setter:test",
      attempts: 1,
      maxAttempts: 5,
      availableAt: now,
      lockedBy: "setter-command-worker",
      lockedUntil: new Date(now.getTime() + 90),
    };
    let leased = false;
    let processed = 0;
    let acknowledged = 0;
    const renewals: Date[] = [];
    const queue: JobQueue = {
      async enqueue() { return { inserted: true }; },
      async lease(request) {
        expect(request.types).toEqual(["conversation.command.execute"]);
        if (leased) return [];
        leased = true;
        return [job];
      },
      async renewLease(_jobId, _workerId, lockedUntil) {
        renewals.push(lockedUntil);
        return true;
      },
      async acknowledge() { acknowledged += 1; },
      async defer() {},
      async retry() { return "scheduled"; },
    };
    const conversationCommandProcessor = {
      async process() {
        processed += 1;
        await Bun.sleep(180);
        await queue.acknowledge(job.id, job.lockedBy, new Date());
      },
    };
    const worker = new ResearchWorker(
      queue,
      { async process() { throw new Error("wrong processor"); } } as unknown as ResearchOrchestrator,
      new SystemClock(),
      {
        workerId: "setter-command-worker",
        leaseMs: 90,
        leaseHeartbeatMs: 50,
        batchSize: 1,
        pollIntervalMs: 1,
        jobTypes: ["conversation.command.execute"],
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      conversationCommandProcessor,
    );

    await worker.tick();

    expect(processed).toBe(1);
    expect(acknowledged).toBe(1);
    expect(renewals.length).toBeGreaterThanOrEqual(2);
    expect(renewals.every((lockedUntil) => lockedUntil.getTime() > now.getTime())).toBe(true);
  });

  test("a lost lease while scheduling a retry does not stop the worker", async () => {
    const now = new Date();
    const job: LeasedJob = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "research.stage.execute",
      payload: {},
      idempotencyKey: "run:stage",
      correlationId: "test",
      attempts: 1,
      maxAttempts: 5,
      availableAt: now,
      lockedBy: "worker-test",
      lockedUntil: new Date(now.getTime() + 60_000),
    };
    const queue: JobQueue = {
      async enqueue() {
        return { inserted: true };
      },
      async lease() {
        return [job];
      },
      async renewLease() {
        return true;
      },
      async acknowledge() {},
      async defer() {},
      async retry() {
        throw new Error("JOB_LEASE_LOST");
      },
    };
    const orchestrator = {
      async process() {
        throw new Error("stage failed");
      },
    } as unknown as ResearchOrchestrator;
    const worker = new ResearchWorker(queue, orchestrator, new SystemClock(), {
      workerId: "worker-test",
      leaseMs: 60_000,
      batchSize: 1,
      pollIntervalMs: 1,
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(worker.tick()).resolves.toBe(1);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test("routes durable prospect discovery jobs to the enrichment processor", async () => {
    const now = new Date();
    const job: LeasedJob = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      type: "prospect.discovery.execute",
      payload: { workspaceId: crypto.randomUUID(), runId: crypto.randomUUID() },
      idempotencyKey: "prospect-run:initial",
      correlationId: "prospect:test",
      attempts: 1,
      maxAttempts: 3,
      availableAt: now,
      lockedBy: "worker-test",
      lockedUntil: new Date(now.getTime() + 60_000),
    };
    let processed = false;
    const queue: JobQueue = {
      async enqueue() { return { inserted: true }; },
      async lease(request) {
        expect(request.types).toContain("prospect.discovery.execute");
        return [job];
      },
      async renewLease() { return true; },
      async acknowledge() {},
      async defer() {},
      async retry() { return "scheduled"; },
    };
    const worker = new ResearchWorker(
      queue,
      { async process() { throw new Error("wrong processor"); } } as unknown as ResearchOrchestrator,
      new SystemClock(),
      { workerId: "worker-test", leaseMs: 60_000, batchSize: 1, pollIntervalMs: 1 },
      undefined,
      { async process() { processed = true; } },
    );

    await worker.tick();
    expect(processed).toBe(true);
  });

  // Regression: ISSUE-002 — long sourcing jobs must not starve prospect decisions.
  // Found by /qa on 2026-08-13.
  test("can reserve a worker exclusively for prospect decisions", async () => {
    const now = new Date();
    let leasedTypes: readonly string[] = [];
    const queue: JobQueue = {
      async enqueue() { return { inserted: true }; },
      async lease(request) {
        leasedTypes = request.types;
        return [];
      },
      async renewLease() { return true; },
      async acknowledge() {},
      async defer() {},
      async retry() { return "scheduled"; },
    };
    const worker = new ResearchWorker(
      queue,
      { async process() {} } as unknown as ResearchOrchestrator,
      { now: () => now },
      {
        workerId: "decision-worker",
        leaseMs: 60_000,
        batchSize: 1,
        pollIntervalMs: 1,
        jobTypes: ["prospect.decision.execute"],
      },
      undefined,
      { async process() { throw new Error("discovery must stay isolated"); } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { async process() {} },
    );

    await worker.tick();
    expect(leasedTypes).toEqual(["prospect.decision.execute"]);
  });
});
