import { describe, expect, spyOn, test } from "bun:test";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { ResearchOrchestrator } from "@outbound/application/gtm/research-orchestrator";
import { SystemClock } from "@outbound/application/shared/ports";
import { ResearchWorker } from "../../apps/worker/src/research-worker";

describe("ResearchWorker job leases", () => {
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
